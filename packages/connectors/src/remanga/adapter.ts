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
const BOOKMARK_TYPES = [0, 1, 2, 3, 4, 5] as const;
const STATUS_NAMES: Record<number, string> = {
  0: "reading",
  1: "planned",
  2: "completed",
  3: "dropped",
  4: "on_hold",
  5: "not_interested",
};

type Cursor = { typeIndex: number; page: number };
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
  if (!value) return { typeIndex: 0, page: 1 };

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      isRecord(parsed) &&
      Number.isInteger(parsed.typeIndex) &&
      Number.isInteger(parsed.page) &&
      (parsed.typeIndex as number) >= 0 &&
      (parsed.typeIndex as number) < BOOKMARK_TYPES.length &&
      (parsed.page as number) >= 1
    ) {
      return { typeIndex: parsed.typeIndex as number, page: parsed.page as number };
    }
  } catch {
    // Fall through to the safe error below.
  }

  throw new ProviderResponseError("Invalid ReManga pagination cursor");
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function responseItems(payload: unknown): { items: unknown[]; hasNext: boolean } {
  if (!isRecord(payload)) throw new ProviderResponseError("ReManga returned an invalid bookmark page");
  const page = isRecord(payload.content) ? payload.content : payload;
  const items = Array.isArray(page.results)
    ? page.results
    : Array.isArray(page.content)
      ? page.content
      : [];
  return { items, hasNext: Boolean(page.next) };
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

function mapBookmark(value: unknown, type: number, observedAt: string): RemoteLibraryEntry {
  if (!isRecord(value) || !isRecord(value.title)) {
    throw new ProviderResponseError("ReManga bookmark has no title object");
  }

  const title = value.title;
  const externalId = stringValue(title.id);
  const slug = stringValue(title.dir) ?? stringValue(title.slug);
  const displayTitle =
    stringValue(title.rus_name) ??
    stringValue(title.name) ??
    stringValue(title.en_name) ??
    stringValue(title.eng_name);

  if (!externalId || !slug || !displayTitle) {
    throw new ProviderResponseError("ReManga bookmark is missing a stable id, slug, or title");
  }

  const aliases = [title.name, title.rus_name, title.en_name, title.eng_name]
    .map(stringValue)
    .filter((item): item is string => Boolean(item) && item !== displayTitle);
  const remoteStatus = STATUS_NAMES[type] ?? `unknown:${type}`;

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
    const bookmarkType = BOOKMARK_TYPES[cursor.typeIndex];
    const url = new URL(`/api/v2/users/${encodeURIComponent(profile.externalId)}/bookmarks/`, API_ORIGIN);
    url.searchParams.set("page", String(cursor.page));
    url.searchParams.set("type", String(bookmarkType));
    url.searchParams.set("ordering", "-chapter_date");

    const payload = await fetchProviderJson(url, session, this.allowedOrigins, context);
    const { items, hasNext } = responseItems(payload);
    const observedAt = (context.now?.() ?? new Date()).toISOString();

    let nextCursor: string | undefined;
    if (hasNext) {
      nextCursor = encodeCursor({ typeIndex: cursor.typeIndex, page: cursor.page + 1 });
    } else if (cursor.typeIndex + 1 < BOOKMARK_TYPES.length) {
      nextCursor = encodeCursor({ typeIndex: cursor.typeIndex + 1, page: 1 });
    }

    return {
      items: items.map((item) => mapBookmark(item, bookmarkType, observedAt)),
      nextCursor,
    };
  }
}
