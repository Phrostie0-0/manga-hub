import { describe, expect, it, vi } from "vitest";

import { MangaLibAdapter } from "../../packages/connectors/src/mangalib/adapter";
import type { ProviderSession } from "../../packages/connectors/src/types";

const session: ProviderSession = {
  formatVersion: 1,
  cookies: [],
  origins: [],
  accessToken: "test-token",
  createdAt: "2026-09-20T10:00:00.000Z",
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("MangaLibAdapter", () => {
  it("verifies the account with the first-party API headers", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ data: { id: 42, username: "reader" } }),
    );

    const profile = await new MangaLibAdapter().verifySession(session, { fetch: fetchMock });

    expect(profile).toEqual({ externalId: "42", displayName: "reader" });
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-token");
    expect(headers.get("site-id")).toBe("1");
  });

  it("imports only non-empty MangaLib folders and preserves the last chapter marker", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            { id: 1, name: "Читаю", count: 1, site_ids: [0, 1, 2, 3, 4] },
            { id: 2, name: "В планах", count: 0, site_ids: [0, 1, 2, 3, 4] },
            { id: 21, name: "Смотрю", count: 10, site_ids: [5] },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              id: 10,
              item_id: 901,
              status: 1,
              updated_at: "2026-09-19T09:00:00.000Z",
              meta: { item_number: 115.5 },
              media: {
                id: 7,
                name: "Example",
                rus_name: "Пример",
                slug_url: "7--example",
                items_count: { uploaded: 130 },
              },
            },
          ],
          meta: { next_page_url: false },
        }),
      );

    const page = await new MangaLibAdapter().listLibrary(
      session,
      { externalId: "42", displayName: "reader" },
      undefined,
      { fetch: fetchMock, now: () => new Date("2026-09-20T10:00:00.000Z") },
    );

    expect(page.nextCursor).toBeUndefined();
    expect(page.items).toEqual([
      expect.objectContaining({
        externalId: "7",
        sourceUrl: "https://mangalib.org/ru/manga/7--example",
        title: "Пример",
        aliases: ["Example"],
        remoteStatus: "reading",
        progress: {
          kind: "last-read",
          lastReadExternalId: "901",
          lastReadLabel: "115.5",
          totalCount: 130,
          observedAt: "2026-09-20T10:00:00.000Z",
        },
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
