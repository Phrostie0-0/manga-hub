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

const API_ORIGIN = "https://api.cdnlibs.org";
const SITE_ID = "1";

type JsonRecord = Record<string, unknown>;
type Folder = { id: number; status: string };
type Cursor = { folderIndex: number; folders: Folder[]; page: number };

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

function unwrapData(payload: unknown): unknown {
  return isRecord(payload) && "data" in payload ? payload.data : payload;
}

function normalizeFolderStatus(id: number, name: string): string {
  const standard: Record<number, string> = {
    1: "reading",
    2: "planned",
    3: "dropped",
    4: "completed",
    5: "favorite",
  };
  return standard[id] ?? `custom:${id}:${name.slice(0, 80)}`;
}

function parseFolders(payload: unknown): Folder[] {
  const data = unwrapData(payload);
  if (!Array.isArray(data)) {
    throw new ProviderResponseError("MangaLib returned an invalid folder list");
  }

  return data.flatMap((value): Folder[] => {
    if (!isRecord(value)) return [];
    const id = numberValue(value.id);
    const name = stringValue(value.name);
    const siteIds = Array.isArray(value.site_ids)
      ? value.site_ids.map(numberValue).filter((item): item is number => item !== undefined)
      : [];
    const count = numberValue(value.count);
    if (id === undefined || !Number.isInteger(id) || !name || !siteIds.includes(1) || count === 0) return [];
    return [{ id, status: normalizeFolderStatus(id, name) }];
  });
}

function decodeCursor(value: string): Cursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      isRecord(parsed) &&
      Number.isInteger(parsed.folderIndex) &&
      Number.isInteger(parsed.page) &&
      Array.isArray(parsed.folders)
    ) {
      const folders = parsed.folders.flatMap((folder): Folder[] => {
        if (!isRecord(folder)) return [];
        const id = numberValue(folder.id);
        const status = stringValue(folder.status);
        return id !== undefined && Number.isInteger(id) && status ? [{ id, status }] : [];
      });
      const folderIndex = parsed.folderIndex as number;
      const page = parsed.page as number;
      if (folders.length === parsed.folders.length && folderIndex >= 0 && folderIndex < folders.length && page >= 1) {
        return { folderIndex, folders, page };
      }
    }
  } catch {
    // The safe error below deliberately hides cursor contents.
  }
  throw new ProviderResponseError("Invalid MangaLib pagination cursor");
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function stableFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function progressFromBookmark(
  bookmark: JsonRecord,
  media: JsonRecord,
  remoteStatus: string,
  observedAt: string,
): RemoteProgress {
  const meta = isRecord(bookmark.meta) ? bookmark.meta : undefined;
  const itemNumber = meta ? stringValue(meta.item_number) : undefined;
  const lastReadExternalId = stringValue(bookmark.item_id);
  const itemCounts = isRecord(media.items_count) ? media.items_count : undefined;
  const totalCount = itemCounts ? numberValue(itemCounts.uploaded) : undefined;

  if (itemNumber || lastReadExternalId) {
    return {
      kind: "last-read",
      lastReadExternalId,
      lastReadLabel: itemNumber,
      totalCount,
      observedAt,
    };
  }

  return {
    kind: "status-only",
    completed: remoteStatus === "completed",
    observedAt,
  };
}

function mapBookmark(value: unknown, remoteStatus: string, observedAt: string): RemoteLibraryEntry {
  if (!isRecord(value) || !isRecord(value.media)) {
    throw new ProviderResponseError("MangaLib bookmark has no media object");
  }

  const media = value.media;
  const externalId = stringValue(media.id);
  const slug = stringValue(media.slug_url) ?? stringValue(media.slug);
  const displayTitle =
    stringValue(media.rus_name) ??
    stringValue(media.name) ??
    stringValue(media.eng_name);

  if (!externalId || !slug || !displayTitle) {
    throw new ProviderResponseError("MangaLib bookmark is missing a stable id, slug, or title");
  }

  const aliases = [media.name, media.rus_name, media.eng_name]
    .map(stringValue)
    .filter((item): item is string => Boolean(item) && item !== displayTitle);

  return {
    externalId,
    sourceUrl: `https://mangalib.org/ru/manga/${slug}`,
    title: displayTitle,
    aliases: [...new Set(aliases)],
    remoteStatus,
    remoteUpdatedAt: stringValue(value.updated_at),
    progress: progressFromBookmark(value, media, remoteStatus, observedAt),
    fingerprint: stableFingerprint(value),
  };
}

function bookmarkPage(payload: unknown): { items: unknown[]; hasNext: boolean } {
  if (!isRecord(payload)) {
    throw new ProviderResponseError("MangaLib returned an invalid bookmark page");
  }
  const items = unwrapData(payload);
  if (!Array.isArray(items)) {
    throw new ProviderResponseError("MangaLib bookmark page has no item array");
  }
  const meta = isRecord(payload.meta) ? payload.meta : undefined;
  return { items, hasNext: Boolean(meta?.next_page_url) };
}

export class MangaLibAdapter implements ProviderAdapter {
  readonly code = "mangalib" as const;
  readonly displayName = "MangaLib";
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
    if (!session.accessToken) throw new ProviderAuthError("MangaLib bearer token is missing");
    const payload = await fetchProviderJson(
      new URL("/api/auth/me", API_ORIGIN),
      session,
      this.allowedOrigins,
      context,
      { headers: { "Site-Id": SITE_ID } },
    );
    const data = unwrapData(payload);
    if (!isRecord(data)) throw new ProviderResponseError("MangaLib returned an invalid profile");

    const externalId = stringValue(data.id) ?? stringValue(data.user_id);
    const displayName =
      stringValue(data.username) ??
      stringValue(data.name) ??
      (externalId ? `MangaLib ${externalId}` : undefined);
    if (!externalId || !displayName) {
      throw new ProviderResponseError("MangaLib current-user response has no account id");
    }
    return { externalId, displayName };
  }

  async listLibrary(
    session: ProviderSession,
    profile: RemoteProfile,
    cursorValue: string | undefined,
    context: ProviderRequestContext,
  ): Promise<Page<RemoteLibraryEntry>> {
    let cursor: Cursor;
    if (cursorValue) {
      cursor = decodeCursor(cursorValue);
    } else {
      const folderPayload = await fetchProviderJson(
        new URL(`/api/bookmarks/folder/${encodeURIComponent(profile.externalId)}`, API_ORIGIN),
        session,
        this.allowedOrigins,
        context,
        { headers: { "Site-Id": SITE_ID } },
      );
      const folders = parseFolders(folderPayload);
      if (folders.length === 0) return { items: [] };
      cursor = { folderIndex: 0, folders, page: 1 };
    }

    const folder = cursor.folders[cursor.folderIndex];
    const url = new URL("/api/bookmarks", API_ORIGIN);
    url.searchParams.set("status", String(folder.id));
    url.searchParams.set("user_id", profile.externalId);
    url.searchParams.set("sort_by", "updated_at");
    url.searchParams.set("sort_type", "desc");
    url.searchParams.set("page", String(cursor.page));

    const payload = await fetchProviderJson(
      url,
      session,
      this.allowedOrigins,
      context,
      { headers: { "Site-Id": SITE_ID } },
    );
    const { items, hasNext } = bookmarkPage(payload);
    const observedAt = (context.now?.() ?? new Date()).toISOString();

    let nextCursor: string | undefined;
    if (hasNext) {
      nextCursor = encodeCursor({ ...cursor, page: cursor.page + 1 });
    } else if (cursor.folderIndex + 1 < cursor.folders.length) {
      nextCursor = encodeCursor({ ...cursor, folderIndex: cursor.folderIndex + 1, page: 1 });
    }

    return {
      items: items.map((item) => mapBookmark(item, folder.status, observedAt)),
      nextCursor,
    };
  }
}
