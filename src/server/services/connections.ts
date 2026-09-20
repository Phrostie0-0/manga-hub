import { and, asc, countDistinct, eq, ilike, ne } from "drizzle-orm";

import type { ProviderCode } from "../../../packages/connectors/src";
import { db, schema } from "@/server/db";
import { planConnectionAction } from "@/server/services/connection-actions";

const ENABLED_PROVIDERS = new Set<ProviderCode>(["remanga", "mangalib"]);

const sourceSeeds = [
  {
    code: "remanga",
    name: "ReManga",
    baseUrl: "https://remanga.org",
    capabilities: {
      browserRequired: true,
      deltaSync: false,
      explicitReadSet: false,
      lastReadOnly: true,
      libraryRead: true,
      progressRead: true,
    },
  },
  {
    code: "mangalib",
    name: "MangaLib",
    baseUrl: "https://mangalib.org",
    capabilities: {
      browserRequired: true,
      deltaSync: false,
      explicitReadSet: false,
      lastReadOnly: true,
      libraryRead: true,
      progressRead: true,
    },
  },
] as const;

async function ensureEnabledSources(): Promise<void> {
  for (const source of sourceSeeds) {
    await db
      .insert(schema.sources)
      .values(source)
      .onConflictDoUpdate({
        target: schema.sources.code,
        set: {
          name: source.name,
          baseUrl: source.baseUrl,
          capabilities: source.capabilities,
          adapterStatus: "active",
        },
      });
  }
}

function providerCode(value: string): ProviderCode {
  if (!ENABLED_PROVIDERS.has(value as ProviderCode)) {
    throw new Error("Source adapter is not enabled");
  }
  return value as ProviderCode;
}

export async function listConnections(userId: string) {
  return db
    .select({
      id: schema.sourceConnections.id,
      sourceCode: schema.sources.code,
      sourceName: schema.sources.name,
      remoteDisplayName: schema.sourceConnections.remoteDisplayName,
      status: schema.sourceConnections.status,
      lastSyncedAt: schema.sourceConnections.lastSuccessfulSyncAt,
    })
    .from(schema.sourceConnections)
    .innerJoin(schema.sources, eq(schema.sourceConnections.sourceId, schema.sources.id))
    .where(
      and(
        eq(schema.sourceConnections.userId, userId),
        ne(schema.sourceConnections.status, "disabled"),
      ),
    )
    .orderBy(asc(schema.sources.name));
}

export async function createOrRestartConnection(userId: string, sourceCodeValue: string) {
  await ensureEnabledSources();
  const code = providerCode(sourceCodeValue);
  const [source] = await db
    .select({ id: schema.sources.id, code: schema.sources.code })
    .from(schema.sources)
    .where(and(eq(schema.sources.code, code), eq(schema.sources.adapterStatus, "active")))
    .limit(1);
  if (!source) throw new Error("Source is not available");

  const [existing] = await db
    .select({
      id: schema.sourceConnections.id,
      status: schema.sourceConnections.status,
      secretConnectionId: schema.sourceSecrets.sourceConnectionId,
    })
    .from(schema.sourceConnections)
    .leftJoin(
      schema.sourceSecrets,
      eq(schema.sourceSecrets.sourceConnectionId, schema.sourceConnections.id),
    )
    .where(
      and(
        eq(schema.sourceConnections.userId, userId),
        eq(schema.sourceConnections.sourceId, source.id),
        ne(schema.sourceConnections.status, "disabled"),
      ),
    )
    .orderBy(asc(schema.sourceConnections.createdAt))
    .limit(1);

  if (existing) {
    const plan = planConnectionAction(existing.status, Boolean(existing.secretConnectionId));
    if (plan.status !== existing.status) {
      await db
        .update(schema.sourceConnections)
        .set({ status: plan.status })
        .where(
          and(
            eq(schema.sourceConnections.id, existing.id),
            eq(schema.sourceConnections.userId, userId),
          ),
        );
    }
    return {
      id: existing.id,
      sourceCode: code,
      ...plan,
    };
  }

  const [connection] = await db
    .insert(schema.sourceConnections)
    .values({ userId, sourceId: source.id, status: "pending_auth" })
    .returning({ id: schema.sourceConnections.id, status: schema.sourceConnections.status });
  if (!connection) throw new Error("Unable to create source connection");
  return { ...connection, sourceCode: code, nextAction: "authorize" as const };
}

export async function getConnectionTarget(connectionId: string) {
  const [row] = await db
    .select({
      id: schema.sourceConnections.id,
      userId: schema.sourceConnections.userId,
      sourceCode: schema.sources.code,
      status: schema.sourceConnections.status,
    })
    .from(schema.sourceConnections)
    .innerJoin(schema.sources, eq(schema.sourceConnections.sourceId, schema.sources.id))
    .where(eq(schema.sourceConnections.id, connectionId))
    .limit(1);
  if (!row) throw new Error("Source connection was not found");
  return { ...row, sourceCode: providerCode(row.sourceCode) };
}

export async function updateConnectionStatus(
  connectionId: string,
  status: (typeof schema.sourceConnectionStatus.enumValues)[number],
) {
  await db
    .update(schema.sourceConnections)
    .set({ status })
    .where(eq(schema.sourceConnections.id, connectionId));
}

function progressLabel(row: {
  completed: boolean;
  lastChapterLabel: string | null;
  readCount: number | null;
  totalCount: number | null;
}): string | null {
  if (row.lastChapterLabel) return `Глава ${row.lastChapterLabel}`;
  if (row.readCount !== null && row.totalCount !== null) {
    return `${row.readCount} из ${row.totalCount}`;
  }
  if (row.readCount !== null) return `${row.readCount} прочитано`;
  if (row.completed) return "Прочитано";
  return null;
}

export async function listLibrary(userId: string, query: string) {
  const filter = query
    ? and(
        eq(schema.userLibrary.userId, userId),
        ilike(schema.works.canonicalTitle, `%${query.replace(/[\\%_]/g, "\\$&")}%`),
      )
    : eq(schema.userLibrary.userId, userId);

  const [countRow, rows] = await Promise.all([
    db
      .select({ value: countDistinct(schema.userLibrary.workId) })
      .from(schema.userLibrary)
      .innerJoin(schema.works, eq(schema.userLibrary.workId, schema.works.id))
      .where(filter),
    db
      .select({
        workId: schema.works.id,
        title: schema.works.canonicalTitle,
        status: schema.userLibrary.status,
        sourceCode: schema.sources.code,
        sourceName: schema.sources.name,
        sourceTitleId: schema.sourceTitles.id,
        metadata: schema.sourceTitles.metadata,
        completed: schema.sourceProgress.completed,
        lastChapterLabel: schema.sourceProgress.lastChapterLabel,
        readCount: schema.sourceProgress.readCount,
        totalCount: schema.sourceProgress.totalCount,
        observedAt: schema.sourceProgress.observedAt,
      })
      .from(schema.userLibrary)
      .innerJoin(schema.works, eq(schema.userLibrary.workId, schema.works.id))
      .leftJoin(schema.sourceTitles, eq(schema.sourceTitles.workId, schema.works.id))
      .leftJoin(
        schema.sourceProgress,
        eq(schema.sourceProgress.sourceTitleId, schema.sourceTitles.id),
      )
      .leftJoin(
        schema.sourceConnections,
        and(
          eq(schema.sourceConnections.id, schema.sourceProgress.sourceConnectionId),
          eq(schema.sourceConnections.userId, userId),
        ),
      )
      .leftJoin(schema.sources, eq(schema.sources.id, schema.sourceTitles.sourceId))
      .where(and(filter, eq(schema.sourceConnections.userId, userId)))
      .orderBy(asc(schema.works.canonicalTitle))
      .limit(500),
  ]);

  const byWork = new Map<
    string,
    {
      id: string;
      title: string;
      status: string;
      coverUrl: string | null;
      sources: Array<{
        code: string;
        name: string;
        progressLabel: string | null;
        observedAt: string | null;
      }>;
    }
  >();

  for (const row of rows) {
    let item = byWork.get(row.workId);
    if (!item) {
      item = {
        id: row.workId,
        title: row.title,
        status: row.status,
        coverUrl: row.metadata?.coverUrl ?? null,
        sources: [],
      };
      byWork.set(row.workId, item);
    }
    if (row.sourceCode && row.sourceName && row.sourceTitleId && row.observedAt) {
      if (!item.sources.some((source) => source.code === row.sourceCode)) {
        item.sources.push({
          code: row.sourceCode,
          name: row.sourceName,
          progressLabel: progressLabel({
            completed: row.completed ?? false,
            lastChapterLabel: row.lastChapterLabel,
            readCount: row.readCount,
            totalCount: row.totalCount,
          }),
          observedAt: row.observedAt.toISOString(),
        });
      }
    }
  }

  return {
    items: [...byWork.values()],
    total: Number(countRow[0]?.value ?? 0),
    nextCursor: null,
  };
}
