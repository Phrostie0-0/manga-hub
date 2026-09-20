import {
  ProviderAuthError,
  ProviderChallengeError,
  ProviderError,
  ProviderRateLimitError,
  getProviderAdapter,
} from "../../../packages/connectors/src";
import type { ProviderRequestContext, RemoteProfile } from "../../../packages/connectors/src/types";
import type { SyncConnection, SyncMode, SyncRepository } from "./contracts";

const MAX_PAGES_PER_RUN = 10_000;

export type RunConnectionSyncInput = {
  connection: SyncConnection;
  mode: SyncMode;
  repository: SyncRepository;
  requestContext?: Partial<ProviderRequestContext>;
};

export type RunConnectionSyncResult = {
  runId: string;
  importedItems: number;
  profile: RemoteProfile;
};

function retryDate(now: Date, retryAfterMs: number | undefined): Date {
  const minimum = 15 * 60 * 1_000;
  const maximum = 24 * 60 * 60 * 1_000;
  const delay = Math.min(maximum, Math.max(minimum, retryAfterMs ?? minimum));
  return new Date(now.getTime() + delay);
}

function safeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderError) return { code: error.code, message: error.message };
  return { code: "SYNC_FAILED", message: "Unexpected synchronization failure" };
}

export async function runConnectionSync({
  connection,
  mode,
  repository,
  requestContext,
}: RunConnectionSyncInput): Promise<RunConnectionSyncResult> {
  const adapter = getProviderAdapter(connection.provider);
  const now = requestContext?.now ?? (() => new Date());
  const context: ProviderRequestContext = {
    fetch: requestContext?.fetch ?? globalThis.fetch,
    signal: requestContext?.signal,
    now,
  };
  const run = await repository.beginRun(connection, mode);

  try {
    const profile = connection.remoteProfile ?? (await adapter.verifySession(connection.session, context));
    await repository.saveRemoteProfile(connection.id, profile);

    let cursor = mode === "incremental" ? connection.cursor : undefined;
    let importedItems = 0;
    let pages = 0;

    do {
      if (pages >= MAX_PAGES_PER_RUN) {
        throw new ProviderError("PAGE_LIMIT", "Provider pagination did not terminate");
      }

      const page = await adapter.listLibrary(connection.session, profile, cursor, context);
      const observedAt = now();
      await repository.saveLibraryPage({
        runId: run.id,
        connection,
        profile,
        items: page.items,
        observedAt,
      });

      importedItems += page.items.length;
      pages += 1;
      cursor = page.nextCursor;
      await repository.saveCursor(connection.id, cursor);
    } while (cursor);

    const completedAt = now();
    await repository.completeRun({ runId: run.id, importedItems, completedAt });
    await repository.setConnectionState({ connectionId: connection.id, state: "active" });
    return { runId: run.id, importedItems, profile };
  } catch (error) {
    const failedAt = now();
    const failure = safeFailure(error);
    await repository.failRun({
      runId: run.id,
      code: failure.code,
      safeMessage: failure.message,
      failedAt,
    });

    if (error instanceof ProviderAuthError) {
      await repository.setConnectionState({
        connectionId: connection.id,
        state: "reauth_required",
      });
    } else if (error instanceof ProviderChallengeError) {
      await repository.setConnectionState({
        connectionId: connection.id,
        state: "needs_attention",
      });
    } else if (error instanceof ProviderRateLimitError) {
      await repository.setConnectionState({
        connectionId: connection.id,
        state: "rate_limited",
        nextSyncAt: retryDate(failedAt, error.retryAfterMs),
      });
    } else {
      await repository.setConnectionState({
        connectionId: connection.id,
        state: "degraded",
      });
    }

    throw error;
  }
}
