import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderAuthError, ProviderRateLimitError } from "../../packages/connectors/src";

const mocks = vi.hoisted(() => ({
  loadConnectionForSync: vi.fn(),
  runConnectionSync: vi.fn(),
  updateConnectionStatus: vi.fn(),
}));

vi.mock("../../src/server/services/source-sessions", () => ({
  loadConnectionForSync: mocks.loadConnectionForSync,
}));
vi.mock("../../src/server/sync", () => ({
  runConnectionSync: mocks.runConnectionSync,
}));
vi.mock("../../src/server/services/connections", () => ({
  updateConnectionStatus: mocks.updateConnectionStatus,
}));
vi.mock("../../src/server/repositories/sync-repository", () => ({
  DrizzleSyncRepository: class DrizzleSyncRepository {},
}));

import { syncSourceTask } from "../../workers/tasks/sync-source";

function helpers() {
  return {
    abortSignal: new AbortController().signal,
    addJob: vi.fn().mockResolvedValue(undefined),
    logger: { warn: vi.fn() },
  };
}

describe("syncSourceTask scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-20T10:00:00.000Z"));
    mocks.loadConnectionForSync.mockReset().mockResolvedValue({ id: "connection-1" });
    mocks.runConnectionSync.mockReset().mockResolvedValue(undefined);
    mocks.updateConnectionStatus.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the hourly chain alive after a successful sync", async () => {
    const taskHelpers = helpers();

    await syncSourceTask(
      { connectionId: "connection-1" },
      taskHelpers as unknown as Parameters<typeof syncSourceTask>[1],
    );

    expect(taskHelpers.addJob).toHaveBeenCalledWith(
      "sync_source",
      { connectionId: "connection-1" },
      {
        jobKey: "sync_source:connection-1",
        jobKeyMode: "replace",
        maxAttempts: 1,
        runAt: new Date("2026-09-20T11:00:00.000Z"),
      },
    );
  });

  it("schedules a later attempt after a transient failure", async () => {
    const taskHelpers = helpers();
    mocks.runConnectionSync.mockRejectedValueOnce(new Error("temporary failure"));

    await syncSourceTask(
      { connectionId: "connection-1" },
      taskHelpers as unknown as Parameters<typeof syncSourceTask>[1],
    );

    expect(taskHelpers.addJob).toHaveBeenCalledOnce();
    expect(taskHelpers.logger.warn).toHaveBeenCalledOnce();
    expect(mocks.updateConnectionStatus).toHaveBeenCalledWith("connection-1", "degraded");
  });

  it("honors provider retry-after and stops when reauthorization is required", async () => {
    const rateLimitedHelpers = helpers();
    mocks.runConnectionSync.mockRejectedValueOnce(new ProviderRateLimitError(2 * 60 * 60 * 1_000));

    await syncSourceTask(
      { connectionId: "connection-1" },
      rateLimitedHelpers as unknown as Parameters<typeof syncSourceTask>[1],
    );

    expect(rateLimitedHelpers.addJob).toHaveBeenCalledWith(
      "sync_source",
      { connectionId: "connection-1" },
      expect.objectContaining({ runAt: new Date("2026-09-20T12:00:00.000Z") }),
    );
    expect(mocks.updateConnectionStatus).toHaveBeenCalledWith("connection-1", "rate_limited");

    const authHelpers = helpers();
    mocks.runConnectionSync.mockRejectedValueOnce(new ProviderAuthError());
    await syncSourceTask(
      { connectionId: "connection-1" },
      authHelpers as unknown as Parameters<typeof syncSourceTask>[1],
    );

    expect(authHelpers.addJob).not.toHaveBeenCalled();
  });
});
