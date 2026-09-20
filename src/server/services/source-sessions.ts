import { eq } from "drizzle-orm";

import type { ProviderCode, ProviderSession, RemoteProfile } from "../../../packages/connectors/src";
import { createFileKeyWrapper, decryptSecret, encryptSecret } from "@/server/crypto";
import { db, schema } from "@/server/db";
import type { SyncConnection } from "@/server/sync";

const PROVIDERS = new Set<ProviderCode>([
  "remanga",
  "mangalib",
  "readmanga",
  "inkstory",
]);

let keyWrapperPromise: ReturnType<typeof createFileKeyWrapper> | undefined;

function getKeyWrapper() {
  const keyFile = process.env.MANGA_HUB_KEK_FILE;
  const keyVersion = process.env.MANGA_HUB_KEK_VERSION ?? "v1";
  if (!keyFile) throw new Error("MANGA_HUB_KEK_FILE is required in worker processes");

  keyWrapperPromise ??= createFileKeyWrapper({
    activeKeyVersion: keyVersion,
    keyFiles: { [keyVersion]: keyFile },
  });
  return keyWrapperPromise;
}

function isProviderCode(value: string): value is ProviderCode {
  return PROVIDERS.has(value as ProviderCode);
}

function parseProviderSession(plaintext: Uint8Array): ProviderSession {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(plaintext).toString("utf8")) as unknown;
  } catch {
    throw new Error("Stored provider session is invalid");
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("formatVersion" in value) ||
    value.formatVersion !== 1 ||
    !("cookies" in value) ||
    !Array.isArray(value.cookies) ||
    !("origins" in value) ||
    !Array.isArray(value.origins) ||
    !("createdAt" in value) ||
    typeof value.createdAt !== "string"
  ) {
    throw new Error("Stored provider session has an unsupported shape");
  }
  return value as ProviderSession;
}

export async function storeProviderSession(input: {
  connectionId: string;
  userId: string;
  sourceCode: ProviderCode;
  session: ProviderSession;
  profile: RemoteProfile;
}): Promise<void> {
  const wrapper = await getKeyWrapper();
  const plaintext = Buffer.from(JSON.stringify(input.session), "utf8");
  try {
    const secret = await encryptSecret(
      plaintext,
      {
        connectionId: input.connectionId,
        sourceCode: input.sourceCode,
        userId: input.userId,
      },
      wrapper,
    );

    await db.transaction(async (tx) => {
      await tx
        .insert(schema.sourceSecrets)
        .values({ sourceConnectionId: input.connectionId, ...secret })
        .onConflictDoUpdate({
          target: schema.sourceSecrets.sourceConnectionId,
          set: secret,
        });
      await tx
        .update(schema.sourceConnections)
        .set({
          remoteAccountId: input.profile.externalId,
          remoteDisplayName: input.profile.displayName,
          knownExpiresAt: input.session.knownExpiresAt
            ? new Date(input.session.knownExpiresAt)
            : null,
          status: "validating",
        })
        .where(eq(schema.sourceConnections.id, input.connectionId));
    });
  } finally {
    plaintext.fill(0);
  }
}

export async function loadConnectionForSync(connectionId: string): Promise<SyncConnection> {
  const [row] = await db
    .select({
      connection: schema.sourceConnections,
      source: schema.sources,
      secret: schema.sourceSecrets,
    })
    .from(schema.sourceConnections)
    .innerJoin(schema.sources, eq(schema.sourceConnections.sourceId, schema.sources.id))
    .innerJoin(
      schema.sourceSecrets,
      eq(schema.sourceSecrets.sourceConnectionId, schema.sourceConnections.id),
    )
    .where(eq(schema.sourceConnections.id, connectionId))
    .limit(1);
  if (!row) throw new Error("Source connection or encrypted session was not found");
  if (!isProviderCode(row.source.code)) throw new Error("Source adapter is not supported");

  const wrapper = await getKeyWrapper();
  const plaintext = await decryptSecret(
    row.secret,
    {
      connectionId: row.connection.id,
      sourceCode: row.source.code,
      userId: row.connection.userId,
    },
    wrapper,
  );
  try {
    const remoteProfile =
      row.connection.remoteAccountId && row.connection.remoteDisplayName
        ? {
            externalId: row.connection.remoteAccountId,
            displayName: row.connection.remoteDisplayName,
          }
        : undefined;
    return {
      id: row.connection.id,
      userId: row.connection.userId,
      provider: row.source.code,
      session: parseProviderSession(plaintext),
      remoteProfile,
      cursor: row.connection.syncCursor ?? undefined,
    };
  } finally {
    plaintext.fill(0);
  }
}
