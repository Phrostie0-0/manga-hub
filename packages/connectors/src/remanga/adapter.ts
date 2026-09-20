import { createHash } from "node:crypto";

import type { ProviderAdapter } from "../contract";
import { ProviderAuthError, ProviderResponseError } from "../errors";
import { fetchProviderJson } from "../http";
import type {
  Page,
  ProviderRequestContext,
  ProviderSession,
  RemoteLibraryEntry,
  RemoteProfile,
  RemoteProgress,
} from "../types";

const API_ORIGIN = "https://api.remanga.org";
const STATUS_NAMES: Record<number, string> = {
  1: "reading",
  2: "planned",
  3: "completed",
  4: "dropped",
  5: "on_hold",
  6: "not_interested",
  7: "favorite",
  8: "custom",
};

type Cursor = { page: number; statusByBookmarkId?: Record<string, string> };
type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function unwrapRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) throw new ProviderResponseError("ReManga returned an unexpected object");
  const content = value.content;
  return isRecord(content) ? content : value;
}

function decodeCursor(value: string | undefined): Cursor {
  if (!value) return { page: 1 };

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (isRecord(parsed) && Number.isInteger(parsed.page) && (parsed.page as number) >= 1) {
      const statusByBookmarkId: Record<string, string> = {};
      if (isRecord(parsed.statusByBookmarkId)) {
        for (const [id, status] of Object.entries(parsed.statusByBookmarkId)) {
          if (id && typeof status === "string" && status) statusByBookmarkId[id] = status;
        }
      }

      // Cursors produced before ReManga's bookmark API change traversed six
      // hard-coded `type` values. Those values are now per-account folder ids,
      // so resuming such a cursor would skip data. Restart safely instead.
      if ("typeIndex" in parsed) return { page: 1 };

      return {
        page: parsed.page as number,
        statusByBookmarkId:
          Object.keys(statusByBookmarkId).length > 0 ? statusByBookmarkId : undefined,
      };
    }
  } catch {
    // Fall through to the safe error below.
  }

  throw new ProviderResponseError("Invalid ReManga pagination cursor");
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function nextPage(value: unknown, currentPage: number): number | undefined {
  if (value === null || value === undefined || value === false || value === "") return undefined;

  const numeric = numberValue(value);
  if (numeric !== undefined && Number.isInteger(numeric) && numeric >= 1) return numeric;

  if (typeof value === "string") {
    try {
      const page = numberValue(new URL(value, API_ORIGIN).searchParams.get("page"));
      if (page !== undefined && Number.isInteger(page) && page >= 1) return page;
    } catch {
      // Fall through to the invalid response below.
    }
  }

  if (value === true) return currentPage + 1;
  throw new ProviderResponseError("ReManga returned an invalid pagination marker");
}

function responseItems(payload: unknown, currentPage: number): { items: unknown[]; nextPage?: number } {
  if (!isRecord(payload)) throw new ProviderResponseError("ReManga returned an invalid bookmark page");
  const page = isRecord(payload.content) ? payload.content : payload;
  const items = Array.isArray(page.results)
    ? page.results
    : Array.isArray(page.content)
      ? page.content
      : [];
  return { items, nextPage: nextPage(page.next, currentPage) };
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function progressFromBookmark(bookmark: JsonRecord, status: string, observedAt: string): RemoteProgress {
  const readCount = numberValue(bookmark.read_progress);
  const totalCount =
    numberValue(bookmark.read_progress_total) ??
    (isRecord(bookmark.title) ? numberValue(bookmark.title.count_chapters) : undefined);

  const chapter = isRecord(bookmark.last_read_chapter)
    ? bookmark.last_read_chapter
    : isRecord(bookmark.chapter)
      ? bookmark.chapter
      : undefined;

  const lastReadLabel = chapter
    ? stringValue(chapter.number) ?? stringValue(chapter.name)
    : stringValue(bookmark.last_read_chapter_number);
  const lastReadExternalId = chapter ? stringValue(chapter.id) : undefined;

  if (readCount !== undefined || lastReadLabel !== undefined || lastReadExternalId !== undefined) {
    return {
      kind: "last-read",
      readCount,
      totalCount,
      lastReadLabel,
      lastReadExternalId,
      observedAt,
    };
  }

  return { kind: "status-only", completed: status === "completed", observedAt };
}

function mapBookmark(
  value: unknown,
  statusByBookmarkId: Readonly<Record<string, string>>,
  observedAt: string,
): RemoteLibraryEntry {
  if (!isRecord(value) || !isRecord(value.title)) {
    throw new ProviderResponseError("ReManga bookmark has no title object");
  }

  const title = value.title;
  const externalId = stringValue(title.id);
  const slug = stringValue(title.dir) ?? stringValue(title.slug);
  const displayTitle =
    stringValue(title.main_name) ??
    stringValue(title.rus_name) ??
    stringValue(title.secondary_name) ??
    stringValue(title.name) ??
    stringValue(title.en_name) ??
    stringValue(title.eng_name);

  if (!externalId || !slug || !displayTitle) {
    throw new ProviderResponseError("ReManga bookmark is missing a stable id, slug, or title");
  }

  const aliases = [
    title.main_name,
    title.secondary_name,
    title.another_name,
    title.name,
    title.rus_name,
    title.en_name,
    title.eng_name,
  ]
    .map(stringValue)
    .filter((item): item is string => Boolean(item) && item !== displayTitle);
  const bookmarkTypeId = stringValue(value.bookmark_type_id) ?? stringValue(value.type);
  const remoteStatus = bookmarkTypeId
    ? statusByBookmarkId[bookmarkTypeId] ?? `unknown:${bookmarkTypeId}`
    : "unknown";

  return {
    externalId,
    sourceUrl: `https://remanga.org/manga/${slug}`,
    title: displayTitle,
    aliases: [...new Set(aliases)],
    remoteStatus,
    remoteUpdatedAt: stringValue(value.chapter_date) ?? stringValue(value.updated_at),
    progress: progressFromBookmark(value, remoteStatus, observedAt),
    fingerprint: stableFingerprint(value),
  };
}

async function bookmarkStatuses(
  session: ProviderSession,
  profile: RemoteProfile,
  context: ProviderRequestContext,
): Promise<Record<string, string>> {
  const statuses: Record<string, string> = {};
  let pageNumber = 1;
  let pageCount = 0;

  do {
    if (pageCount >= 100) {
      throw new ProviderResponseError("ReManga bookmark-folder pagination did not terminate");
    }

    const url = new URL(
      `/api/v2/users/${encodeURIComponent(profile.externalId)}/user_bookmarks/`,
      API_ORIGIN,
    );
    if (pageNumber > 1) url.searchParams.set("page", String(pageNumber));

    const payload = await fetchProviderJson(url, session, [API_ORIGIN], context);
    const folderPage = responseItems(payload, pageNumber);
    for (const value of folderPage.items) {
      if (!isRecord(value)) continue;
      const id = stringValue(value.id);
      const type = numberValue(value.type);
      if (id && type !== undefined) statuses[id] = STATUS_NAMES[type] ?? `unknown:${type}`;
    }

    pageCount += 1;
    pageNumber = folderPage.nextPage ?? 0;
  } while (pageNumber > 0);

  return statuses;
}

export class ReMangaAdapter implements ProviderAdapter {
  readonly code = "remanga" as const;
  readonly displayName = "ReManga";
  readonly allowedOrigins = [API_ORIGIN] as const;
  readonly capabilities = {
    libraryRead: true,
    progressRead: true,
    explicitReadSet: false,
    lastReadOnly: true,
    deltaSync: false,
    browserRequired: true,
  } as const;

  async verifySession(
    session: ProviderSession,
    context: ProviderRequestContext,
  ): Promise<RemoteProfile> {
    if (!session.accessToken) throw new ProviderAuthError("ReManga bearer token is missing");

    const payload = await fetchProviderJson(
      new URL("/api/v2/users/current/", API_ORIGIN),
      session,
      this.allowedOrigins,
      context,
    );
    const profile = unwrapRecord(payload);
    const externalId = stringValue(profile.id) ?? stringValue(profile.user_id);
    const displayName =
      stringValue(profile.username) ?? stringValue(profile.name) ?? (externalId ? `ReManga ${externalId}` : undefined);

    if (!externalId || !displayName) {
      throw new ProviderResponseError("ReManga current-user response has no account id");
    }

    return { externalId, displayName };
  }

  async listLibrary(
    session: ProviderSession,
    profile: RemoteProfile,
    cursorValue: string | undefined,
    context: ProviderRequestContext,
  ): Promise<Page<RemoteLibraryEntry>> {
    const cursor = decodeCursor(cursorValue);
    const url = new URL(`/api/v2/users/${encodeURIComponent(profile.externalId)}/bookmarks/`, API_ORIGIN);
    url.searchParams.set("page", String(cursor.page));
    url.searchParams.set("ordering", "-chapter_date");

    const statusByBookmarkId =
      cursor.statusByBookmarkId ?? (await bookmarkStatuses(session, profile, context));
    const payload = await fetchProviderJson(url, session, this.allowedOrigins, context);
    const { items, nextPage: followingPage } = responseItems(payload, cursor.page);
    const observedAt = (context.now?.() ?? new Date()).toISOString();

    return {
      items: items.map((item) => mapBookmark(item, statusByBookmarkId, observedAt)),
      nextCursor: followingPage
        ? encodeCursor({ page: followingPage, statusByBookmarkId })
        : undefined,
    };
  }
}
