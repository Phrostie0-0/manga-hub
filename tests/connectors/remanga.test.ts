import { describe, expect, it, vi } from "vitest";

import { ProviderAuthError } from "../../packages/connectors/src/errors";
import { ReMangaAdapter } from "../../packages/connectors/src/remanga/adapter";
import type { ProviderSession } from "../../packages/connectors/src/types";

const session: ProviderSession = {
  formatVersion: 1,
  cookies: [],
  origins: [],
  accessToken: "test-token",
  createdAt: "2026-09-20T10:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ReMangaAdapter", () => {
  it("verifies a bearer session", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ content: { id: 42, username: "reader" } }),
    );

    const profile = await new ReMangaAdapter().verifySession(session, { fetch: fetchMock });

    expect(profile).toEqual({ externalId: "42", displayName: "reader" });
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer test-token",
    );
  });

  it("maps only personal bookmarks and preserves progress semantics", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          next: null,
          results: [
            { id: 9001, type: 1 },
            { id: 9002, type: 3 },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          next: 2,
          results: [
            {
              bookmark_type_id: 9001,
              type: 9001,
              read_progress: 17,
              read_progress_total: 35,
              title: {
                id: 7,
                dir: "7-example",
                main_name: "Пример",
                secondary_name: "Example",
                another_name: "Sample",
                count_chapters: 35,
              },
            },
          ],
        }),
      );

    const adapter = new ReMangaAdapter();
    const page = await adapter.listLibrary(
      session,
      { externalId: "42", displayName: "reader" },
      undefined,
      { fetch: fetchMock, now: () => new Date("2026-09-20T10:00:00.000Z") },
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      externalId: "7",
      sourceUrl: "https://remanga.org/manga/7-example",
      title: "Пример",
      aliases: ["Example", "Sample"],
      remoteStatus: "reading",
      progress: {
        kind: "last-read",
        readCount: 17,
        totalCount: 35,
      },
    });
    expect(page.nextCursor).toBeTypeOf("string");

    const folderUrl = new URL(fetchMock.mock.calls[0]?.[0] as URL);
    const libraryUrl = new URL(fetchMock.mock.calls[1]?.[0] as URL);
    expect(folderUrl.pathname).toBe("/api/v2/users/42/user_bookmarks/");
    expect(libraryUrl.pathname).toBe("/api/v2/users/42/bookmarks/");
    expect(libraryUrl.searchParams.get("type")).toBeNull();
    expect(libraryUrl.searchParams.get("page")).toBe("1");

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        next: null,
        results: [
          {
            bookmark_type_id: 9002,
            type: 9002,
            read_progress: 35,
            read_progress_total: 35,
            title: {
              id: 8,
              dir: "8-finished",
              main_name: "Завершённый пример",
              count_chapters: 35,
            },
          },
        ],
      }),
    );

    const secondPage = await adapter.listLibrary(
      session,
      { externalId: "42", displayName: "reader" },
      page.nextCursor,
      { fetch: fetchMock, now: () => new Date("2026-09-20T10:00:00.000Z") },
    );

    expect(secondPage.items[0]).toMatchObject({
      externalId: "8",
      remoteStatus: "completed",
    });
    expect(secondPage.nextCursor).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const secondLibraryUrl = new URL(fetchMock.mock.calls[2]?.[0] as URL);
    expect(secondLibraryUrl.searchParams.get("page")).toBe("2");
  });

  it("turns a 401 into a reauthentication state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 401));

    await expect(
      new ReMangaAdapter().verifySession(session, { fetch: fetchMock }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });
});
