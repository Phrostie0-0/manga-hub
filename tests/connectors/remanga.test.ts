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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        next: null,
        results: [
          {
            chapter_date: "2026-09-19T09:00:00Z",
            read_progress: 17,
            read_progress_total: 35,
            title: {
              id: 7,
              dir: "7-example",
              rus_name: "Пример",
              name: "Example",
              count_chapters: 35,
            },
          },
        ],
      }),
    );

    const page = await new ReMangaAdapter().listLibrary(
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
      aliases: ["Example"],
      remoteStatus: "reading",
      progress: {
        kind: "last-read",
        readCount: 17,
        totalCount: 35,
      },
    });
    expect(page.nextCursor).toBeTypeOf("string");
  });

  it("turns a 401 into a reauthentication state", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}, 401));

    await expect(
      new ReMangaAdapter().verifySession(session, { fetch: fetchMock }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
  });
});
