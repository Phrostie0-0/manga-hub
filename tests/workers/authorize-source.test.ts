import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderRateLimitError } from "../../packages/connectors/src";

const mocks = vi.hoisted(() => ({
  captureSession: vi.fn(),
  getConnectionTarget: vi.fn(),
  runConnectionSync: vi.fn(),
  storeProviderSession: vi.fn(),
  updateConnectionStatus: vi.fn(),
}));

vi.mock("../../workers/auth-browser", () => ({
  LocalMangaLibAuthBrowser: class {
    captureSession = mocks.captureSession;
  },
  LocalReMangaAuthBrowser: class {
    captureSession = mocks.captureSession;
  },
}));
vi.mock("../../src/server/services/connections", () => ({
  getConnectionTarget: mocks.getConnectionTarget,
  updateConnectionStatus: mocks.updateConnectionStatus,
}));
vi.mock("../../src/server/services/source-sessions", () => ({
  storeProviderSession: mocks.storeProviderSession,
}));
vi.mock("../../src/server/sync", () => ({
  runConnectionSync: mocks.runConnectionSync,
}));
vi.mock("../../src/server/repositories/sync-repository", () => ({
  DrizzleSyncRepository: class DrizzleSyncRepository {},
}));

import { authorizeSourceTask } from "../../workers/tasks/authorize-source";

const captured = {
  provider: "remanga" as const,
  profile: { externalId: "remote-1", displayName: "reader" },
  session: {
    formatVersion: 1 as const,
    cookies: [],
    origins: [],
    createdAt: "2026-09-20T10:00:00.000Z",
  },
};

function helpers() {
  return {
    abortSignal: new AbortController().signal,
    addJob: vi.fn().mockResolvedValue(undefined),
    logger: { error: vi.fn(), warn: vi.fn() },
  };
}

describe("authorizeSourceTask failure recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z"));
    mocks.captureSession.mockReset().mockResolvedValue(captured);
    mocks.getConnectionTarget.mockReset().mockResolvedValue({
      sourceCode: "remanga",
      status: "pending_auth",
      userId: "user-1",
    });
    mocks.runConnectionSync.mockReset().mockResolvedValue(undefined);
    mocks.storeProviderSession.mockReset().mockResolvedValue(undefined);
    mocks.updateConnectionStatus.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes authorization retryable when the captured session cannot be stored", async () => {
    const taskHelpers = helpers();
    mocks.storeProviderSession.mockRejectedValueOnce(new Error("key unavailable"));

    await authorizeSourceTask(
      { connectionId: "connection-1" },
      taskHelpers as unknown as Parameters<typeof authorizeSourceTask>[1],
    );

    expect(mocks.updateConnectionStatus).toHaveBeenLastCalledWith(
      "connection-1",
      "needs_attention",
    );
    expect(taskHelpers.addJob).not.toHaveBeenCalled();
  });

  it("schedules the first sync again after a provider rate limit", async () => {
    const taskHelpers = helpers();
    mocks.runConnectionSync.mockRejectedValueOnce(new ProviderRateLimitError(2 * 60 * 60 * 1_000));

    await authorizeSourceTask(
      { connectionId: "connection-1" },
      taskHelpers as unknown as Parameters<typeof authorizeSourceTask>[1],
    );

    expect(mocks.updateConnectionStatus).toHaveBeenLastCalledWith(
      "connection-1",
      "rate_limited",
    );
    expect(taskHelpers.addJob).toHaveBeenCalledWith(
      "sync_source",
      { connectionId: "connection-1" },
      expect.objectContaining({ runAt: new Date("2026-09-20T12:00:00.000Z") }),
    );
  });
});
