import type { Task } from "graphile-worker";

import { DrizzleSyncRepository } from "../../src/server/repositories/sync-repository";
import { updateConnectionStatus } from "../../src/server/services/connections";
import { loadConnectionForSync } from "../../src/server/services/source-sessions";
import { runConnectionSync } from "../../src/server/sync";
import { HOURLY_SYNC_MS, syncFailureDisposition } from "./sync-policy";

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
    nextRunAt = new Date(Date.now() + HOURLY_SYNC_MS);
  } catch (error) {
    const disposition = syncFailureDisposition(error);
    await updateConnectionStatus(connectionId, disposition.status);
    if (disposition.retryDelayMs === undefined) return;

    nextRunAt = new Date(Date.now() + disposition.retryDelayMs);
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
