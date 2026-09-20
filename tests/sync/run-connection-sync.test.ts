import { describe, expect, it, vi } from "vitest";

import type { ProviderSession } from "../../packages/connectors/src";
import type { SyncRepository } from "../../src/server/sync/contracts";
import { runConnectionSync } from "../../src/server/sync/run-connection-sync";

const session: ProviderSession = {
  formatVersion: 1,
  cookies: [],
  origins: [],
  accessToken: "token",
  createdAt: "2026-09-20T10:00:00.000Z",
};

function repository(): SyncRepository {
  return {
    beginRun: vi.fn().mockResolvedValue({ id: "run-1", connectionId: "connection-1", mode: "initial" }),
    saveRemoteProfile: vi.fn().mockResolvedValue(undefined),
    saveLibraryPage: vi.fn().mockResolvedValue(undefined),
    saveCursor: vi.fn().mockResolvedValue(undefined),
    completeRun: vi.fn().mockResolvedValue(undefined),
    failRun: vi.fn().mockResolvedValue(undefined),
    setConnectionState: vi.fn().mockResolvedValue(undefined),
  };
}

describe("runConnectionSync", () => {
  it("imports a personal ReManga library page and completes idempotently", async () => {
    const repo = repository();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ content: { id: 42, username: "reader" } }), { status: 200 }),
      )
      .mockImplementation(async () =>
        new Response(JSON.stringify({ results: [], next: null }), { status: 200 }),
      );

    const result = await runConnectionSync({
      connection: {
        id: "connection-1",
        userId: "user-1",
        provider: "remanga",
        session,
      },
      mode: "initial",
      repository: repo,
      requestContext: {
        fetch: fetchMock,
        now: () => new Date("2026-09-20T10:00:00.000Z"),
      },
    });

    // Profile, bookmark-folder map, then the unified personal bookmark page.
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ runId: "run-1", importedItems: 0 });
    expect(repo.completeRun).toHaveBeenCalledWith({
      runId: "run-1",
      importedItems: 0,
      completedAt: new Date("2026-09-20T10:00:00.000Z"),
    });
    expect(repo.setConnectionState).toHaveBeenLastCalledWith({
      connectionId: "connection-1",
      state: "active",
    });
  });
});
