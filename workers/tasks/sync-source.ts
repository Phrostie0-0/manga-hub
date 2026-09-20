import type { Task } from "graphile-worker";

import {
  ProviderAuthError,
  ProviderChallengeError,
  ProviderRateLimitError,
} from "../../packages/connectors/src";
import { DrizzleSyncRepository } from "../../src/server/repositories/sync-repository";
import { loadConnectionForSync } from "../../src/server/services/source-sessions";
import { runConnectionSync } from "../../src/server/sync";

const HOUR_MS = 60 * 60 * 1_000;
const MINIMUM_RETRY_MS = 15 * 60 * 1_000;
const MAXIMUM_RETRY_MS = 24 * HOUR_MS;

function connectionIdFromPayload(payload: unknown): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("connectionId" in payload) ||
    typeof payload.connectionId !== "string"
  ) {
    throw new Error("sync_source requires a connectionId");
  }
  return payload.connectionId;
}

export const syncSourceTask: Task = async (payload, helpers) => {
  const connectionId = connectionIdFromPayload(payload);
  let nextRunAt: Date | undefined;

  try {
    const connection = await loadConnectionForSync(connectionId);

    await runConnectionSync({
      connection,
      mode: "incremental",
      repository: new DrizzleSyncRepository(),
      requestContext: { signal: helpers.abortSignal },
    });
    nextRunAt = new Date(Date.now() + HOUR_MS);
  } catch (error) {
    if (error instanceof ProviderAuthError || error instanceof ProviderChallengeError) {
      return;
    }

    const delay =
      error instanceof ProviderRateLimitError
        ? Math.min(
            MAXIMUM_RETRY_MS,
            Math.max(MINIMUM_RETRY_MS, error.retryAfterMs ?? MINIMUM_RETRY_MS),
          )
        : HOUR_MS;
    nextRunAt = new Date(Date.now() + delay);
    helpers.logger.warn("Source sync failed; a later attempt was scheduled", {
      connectionId,
      error: error instanceof Error ? error.message : "Unknown synchronization error",
    });
  }

  await helpers.addJob(
    "sync_source",
    { connectionId },
    {
      jobKey: `sync_source:${connectionId}`,
      jobKeyMode: "replace",
      maxAttempts: 1,
      runAt: nextRunAt,
    },
  );
};
