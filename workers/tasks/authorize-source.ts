import type { Task } from "graphile-worker";

import { runConnectionSync } from "../../src/server/sync";
import {
  getConnectionTarget,
  updateConnectionStatus,
} from "../../src/server/services/connections";
import { DrizzleSyncRepository } from "../../src/server/repositories/sync-repository";
import { storeProviderSession } from "../../src/server/services/source-sessions";
import {
  LocalMangaLibAuthBrowser,
  LocalReMangaAuthBrowser,
  type AuthBrowserTransport,
} from "../auth-browser";

function connectionIdFromPayload(payload: unknown): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("connectionId" in payload) ||
    typeof payload.connectionId !== "string"
  ) {
    throw new Error("authorize_source requires a connectionId");
  }
  return payload.connectionId;
}

function authBrowser(sourceCode: string): AuthBrowserTransport {
  if (sourceCode === "remanga") return new LocalReMangaAuthBrowser();
  if (sourceCode === "mangalib") return new LocalMangaLibAuthBrowser();
  throw new Error("No interactive browser is enabled for this source");
}

export const authorizeSourceTask: Task = async (payload, helpers) => {
  const connectionId = connectionIdFromPayload(payload);
  const target = await getConnectionTarget(connectionId);
  if (target.status === "active") return;

  await updateConnectionStatus(connectionId, "awaiting_user");
  let captured;
  try {
    captured = await authBrowser(target.sourceCode).captureSession({
      headless: process.env.AUTH_BROWSER_HEADLESS === "true",
      signal: helpers.abortSignal,
    });
  } catch (error) {
    await updateConnectionStatus(connectionId, "needs_attention");
    helpers.logger.error("Interactive source authorization did not complete", {
      connectionId,
      error: error instanceof Error ? error.message : "Unknown authorization error",
    });
    return;
  }

  if (captured.provider !== target.sourceCode) {
    await updateConnectionStatus(connectionId, "degraded");
    throw new Error("Captured session belongs to a different source adapter");
  }

  await storeProviderSession({
    connectionId,
    userId: target.userId,
    sourceCode: target.sourceCode,
    session: captured.session,
    profile: captured.profile,
  });

  await runConnectionSync({
    connection: {
      id: connectionId,
      userId: target.userId,
      provider: target.sourceCode,
      session: captured.session,
      remoteProfile: captured.profile,
    },
    mode: "initial",
    repository: new DrizzleSyncRepository(),
  });

  await helpers.addJob(
    "sync_source",
    { connectionId },
    {
      jobKey: `sync_source:${connectionId}`,
      jobKeyMode: "replace",
      maxAttempts: 1,
      runAt: new Date(Date.now() + 60 * 60 * 1_000),
    },
  );
};
