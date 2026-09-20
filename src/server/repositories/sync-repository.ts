import { and, eq, sql } from "drizzle-orm";

import type { RemoteLibraryEntry } from "../../../packages/connectors/src";
import { db, schema } from "@/server/db";
import type {
  SyncConnection,
  SyncMode,
  SyncRepository,
  SyncRunRecord,
} from "@/server/sync/contracts";

type Database = typeof db;
type LibraryStatus = (typeof schema.libraryStatus.enumValues)[number];
type ProgressSemantics = (typeof schema.progressSemantics.enumValues)[number];

function normalizedTitle(title: string): string {
  return title
    .normalize("NFKC")
    .toLocaleLowerCase("ru")
    .replace(/[«»“”„]/g, '"')
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function safeDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function libraryStatus(value: string): LibraryStatus {
  switch (value) {
    case "reading":
      return "reading";
    case "planned":
      return "planned";
    case "completed":
      return "completed";
    case "dropped":
      return "dropped";
    case "on_hold":
      return "on_hold";
    default:
      return "unknown";
  }
}

function numericChapter(label: string | undefined): string | null {
  if (!label || !/^\d+(?:\.\d+)?$/.test(label)) return null;
  return label;
}

function progressValues(entry: RemoteLibraryEntry) {
  const common = {
    completed: entry.remoteStatus === "completed",
    evidenceHash: entry.fingerprint,
    lastChapterExternalId: null as string | null,
    lastChapterLabel: null as string | null,
    lastChapterNumber: null as string | null,
    readChapters: [] as Array<{ externalId?: string; label: string }>,
    readCount: null as number | null,
    totalCount: null as number | null,
    remoteUpdatedAt: safeDate(entry.remoteUpdatedAt) ?? null,
    observedAt: new Date(entry.progress.observedAt),
    semantics: "unknown" as ProgressSemantics,
  };

  if (entry.progress.kind === "last-read") {
    return {
      ...common,
      semantics: "last_read" as const,
      lastChapterExternalId: entry.progress.lastReadExternalId ?? null,
      lastChapterLabel: entry.progress.lastReadLabel ?? null,
      lastChapterNumber: numericChapter(entry.progress.lastReadLabel),
      readCount: entry.progress.readCount ?? null,
      totalCount: entry.progress.totalCount ?? null,
    };
  }
  if (entry.progress.kind === "explicit-read-set") {
    return {
      ...common,
      semantics: "explicit_read_set" as const,
      readCount: entry.progress.chapterExternalIds.length,
      readChapters: entry.progress.chapterExternalIds.map((externalId) => ({
        externalId,
        label: externalId,
      })),
    };
  }
  return {
    ...common,
    completed: entry.progress.completed,
    semantics: "completed_only" as const,
  };
}

function runTrigger(mode: SyncMode): (typeof schema.syncRunTrigger.enumValues)[number] {
  if (mode === "initial") return "initial_import";
  if (mode === "reconcile") return "full_reconcile";
  return "scheduled";
}

/**
 * Persists normalized sync results. Every public operation is scoped by the
 * connection's user id; repeated provider pages update existing rows.
 */
export class DrizzleSyncRepository implements SyncRepository {
  constructor(private readonly database: Database = db) {}

  async beginRun(connection: SyncConnection, mode: SyncMode): Promise<SyncRunRecord> {
    const [run] = await this.database
      .insert(schema.syncRuns)
      .values({
        sourceConnectionId: connection.id,
        trigger: runTrigger(mode),
        status: "running",
        startedAt: new Date(),
      })
      .returning({ id: schema.syncRuns.id });
    if (!run) throw new Error("Unable to create synchronization run");
    return { id: run.id, connectionId: connection.id, mode };
  }

  async saveRemoteProfile(
    connectionId: string,
    profile: { externalId: string; displayName: string },
  ): Promise<void> {
    await this.database
      .update(schema.sourceConnections)
      .set({
        remoteAccountId: profile.externalId,
        remoteDisplayName: profile.displayName,
        status: "importing",
      })
      .where(eq(schema.sourceConnections.id, connectionId));
  }

  async saveLibraryPage(input: {
    runId: string;
    connection: SyncConnection;
    profile: { externalId: string; displayName: string };
    items: RemoteLibraryEntry[];
    observedAt: Date;
  }): Promise<void> {
    await this.database.transaction(async (tx) => {
      const [connection] = await tx
        .select({ sourceId: schema.sourceConnections.sourceId })
        .from(schema.sourceConnections)
        .where(
          and(
            eq(schema.sourceConnections.id, input.connection.id),
            eq(schema.sourceConnections.userId, input.connection.userId),
          ),
        )
        .limit(1);
      if (!connection) throw new Error("Synchronization connection was not found");

      for (const entry of input.items) {
        const normalized = normalizedTitle(entry.title);
        if (!normalized) continue;

        const [existingSourceTitle] = await tx
          .select({ workId: schema.sourceTitles.workId })
          .from(schema.sourceTitles)
          .where(
            and(
              eq(schema.sourceTitles.sourceId, connection.sourceId),
              eq(schema.sourceTitles.externalId, entry.externalId),
            ),
          )
          .limit(1);

        let workId = existingSourceTitle?.workId ?? undefined;
        if (!workId) {
          const [matchingWork] = await tx
            .select({ id: schema.works.id })
            .from(schema.works)
            .where(eq(schema.works.normalizedTitle, normalized))
            .limit(1);
          workId = matchingWork?.id;
        }
        if (!workId) {
          const [createdWork] = await tx
            .insert(schema.works)
            .values({ canonicalTitle: entry.title, normalizedTitle: normalized })
            .returning({ id: schema.works.id });
          if (!createdWork) throw new Error("Unable to create normalized work");
          workId = createdWork.id;
        }

        const [sourceTitle] = await tx
          .insert(schema.sourceTitles)
          .values({
            sourceId: connection.sourceId,
            workId,
            externalId: entry.externalId,
            title: entry.title,
            normalizedTitle: normalized,
            url: entry.sourceUrl,
            metadata: { aliases: entry.aliases },
            remoteUpdatedAt: safeDate(entry.remoteUpdatedAt),
            lastSeenAt: input.observedAt,
          })
          .onConflictDoUpdate({
            target: [schema.sourceTitles.sourceId, schema.sourceTitles.externalId],
            set: {
              title: entry.title,
              normalizedTitle: normalized,
              url: entry.sourceUrl,
              metadata: { aliases: entry.aliases },
              remoteUpdatedAt: safeDate(entry.remoteUpdatedAt),
              lastSeenAt: input.observedAt,
              workId: sql`coalesce(${schema.sourceTitles.workId}, ${workId})`,
            },
          })
          .returning({ id: schema.sourceTitles.id });
        if (!sourceTitle) throw new Error("Unable to store source title");

        const status = libraryStatus(entry.remoteStatus);
        await tx
          .insert(schema.userLibrary)
          .values({
            userId: input.connection.userId,
            workId,
            status,
            lastSeenAt: input.observedAt,
          })
          .onConflictDoUpdate({
            target: [schema.userLibrary.userId, schema.userLibrary.workId],
            set: {
              lastSeenAt: input.observedAt,
              archivedAt: null,
              status: sql`case
                when excluded.status = 'completed' then excluded.status
                when ${schema.userLibrary.status} = 'completed' then ${schema.userLibrary.status}
                when excluded.status = 'unknown' then ${schema.userLibrary.status}
                else excluded.status
              end`,
            },
          });

        const progress = progressValues(entry);
        await tx
          .insert(schema.sourceProgress)
          .values({
            sourceConnectionId: input.connection.id,
            sourceTitleId: sourceTitle.id,
            ...progress,
          })
          .onConflictDoUpdate({
            target: [
              schema.sourceProgress.sourceConnectionId,
              schema.sourceProgress.sourceTitleId,
            ],
            set: progress,
          });
      }

      await tx
        .update(schema.syncRuns)
        .set({ discoveredCount: sql`${schema.syncRuns.discoveredCount} + ${input.items.length}` })
        .where(eq(schema.syncRuns.id, input.runId));
    });
  }

  async saveCursor(connectionId: string, cursor: string | undefined): Promise<void> {
    await this.database
      .update(schema.sourceConnections)
      .set({ syncCursor: cursor ?? null })
      .where(eq(schema.sourceConnections.id, connectionId));
  }

  async completeRun(input: {
    runId: string;
    importedItems: number;
    completedAt: Date;
  }): Promise<void> {
    await this.database
      .update(schema.syncRuns)
      .set({
        status: "succeeded",
        importedCount: input.importedItems,
        finishedAt: input.completedAt,
      })
      .where(eq(schema.syncRuns.id, input.runId));
  }

  async failRun(input: {
    runId: string;
    code: string;
    safeMessage: string;
    failedAt: Date;
  }): Promise<void> {
    await this.database
      .update(schema.syncRuns)
      .set({
        status: "failed",
        failedCount: 1,
        safeErrorCode: input.code.slice(0, 128),
        safeErrorMessage: input.safeMessage.slice(0, 1_000),
        finishedAt: input.failedAt,
      })
      .where(eq(schema.syncRuns.id, input.runId));
  }

  async setConnectionState(input: {
    connectionId: string;
    state: "active" | "reauth_required" | "needs_attention" | "rate_limited" | "degraded";
    nextSyncAt?: Date;
  }): Promise<void> {
    const now = new Date();
    const successful = input.state === "active";
    await this.database
      .update(schema.sourceConnections)
      .set({
        status: input.state,
        lastSyncAt: now,
        lastSuccessfulSyncAt: successful ? now : undefined,
        nextSyncAt: input.nextSyncAt ?? (successful ? new Date(now.getTime() + 60 * 60 * 1_000) : undefined),
      })
      .where(eq(schema.sourceConnections.id, input.connectionId));
  }
}
