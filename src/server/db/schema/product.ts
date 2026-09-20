import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

const timestampColumn = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true });

const binary = customType<{
  data: Uint8Array;
  driverData: Buffer;
}>({
  dataType() {
    return "bytea";
  },
  fromDriver(value) {
    return Uint8Array.from(value);
  },
  toDriver(value) {
    return Buffer.from(value);
  },
});

export const sourceAdapterStatus = pgEnum("source_adapter_status", [
  "active",
  "degraded",
  "disabled",
]);

export const sourceConnectionStatus = pgEnum("source_connection_status", [
  "pending_auth",
  "awaiting_user",
  "validating",
  "importing",
  "active",
  "reauth_required",
  "needs_attention",
  "rate_limited",
  "degraded",
  "disabled",
]);

export const libraryStatus = pgEnum("library_status", [
  "unknown",
  "planned",
  "reading",
  "on_hold",
  "completed",
  "dropped",
]);

export const progressSemantics = pgEnum("progress_semantics", [
  "unknown",
  "explicit_read_set",
  "last_read",
  "completed_only",
]);

export const syncRunTrigger = pgEnum("sync_run_trigger", [
  "initial_import",
  "manual",
  "scheduled",
  "full_reconcile",
]);

export const syncRunStatus = pgEnum("sync_run_status", [
  "queued",
  "running",
  "succeeded",
  "partial_failure",
  "failed",
  "cancelled",
]);

export type SourceCapabilities = {
  browserRequired: boolean;
  deltaSync: boolean;
  explicitReadSet: boolean;
  lastReadOnly: boolean;
  libraryRead: boolean;
  progressRead: boolean;
};

export type SourceMetadata = {
  aliases?: string[];
  authors?: string[];
  coverUrl?: string;
  publicationYear?: number;
};

export type ReadChapterMarker = {
  externalId?: string;
  label: string;
  number?: string;
  part?: string;
  volume?: string;
};

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    code: varchar("code", { length: 64 }).notNull(),
    name: text("name").notNull(),
    baseUrl: text("base_url").notNull(),
    capabilities: jsonb("capabilities").$type<SourceCapabilities>().notNull(),
    adapterStatus: sourceAdapterStatus("adapter_status")
      .default("active")
      .notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [uniqueIndex("sources_code_uq").on(table.code)],
);

export const sourceConnections = pgTable(
  "source_connections",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    remoteAccountId: text("remote_account_id"),
    remoteDisplayName: text("remote_display_name"),
    status: sourceConnectionStatus("status").default("pending_auth").notNull(),
    syncEnabled: boolean("sync_enabled").default(true).notNull(),
    syncIntervalMinutes: integer("sync_interval_minutes").default(60).notNull(),
    knownExpiresAt: timestampColumn("known_expires_at"),
    syncCursor: text("sync_cursor"),
    nextSyncAt: timestampColumn("next_sync_at"),
    lastSyncAt: timestampColumn("last_sync_at"),
    lastSuccessfulSyncAt: timestampColumn("last_successful_sync_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("source_connections_user_source_remote_account_uq")
      .on(table.userId, table.sourceId, table.remoteAccountId)
      .where(sql`${table.remoteAccountId} is not null`),
    index("source_connections_user_id_idx").on(table.userId),
    index("source_connections_source_id_idx").on(table.sourceId),
    index("source_connections_due_sync_idx")
      .on(table.nextSyncAt)
      .where(sql`${table.syncEnabled} = true`),
    check(
      "source_connections_sync_interval_positive",
      sql`${table.syncIntervalMinutes} > 0`,
    ),
  ],
);

export const sourceSecrets = pgTable(
  "source_secrets",
  {
    sourceConnectionId: uuid("source_connection_id")
      .primaryKey()
      .references(() => sourceConnections.id, { onDelete: "cascade" }),
    formatVersion: smallint("format_version").notNull(),
    cipher: varchar("cipher", { length: 64 }).notNull(),
    ciphertext: binary("ciphertext").notNull(),
    payloadNonce: binary("payload_nonce").notNull(),
    wrapCipher: varchar("wrap_cipher", { length: 64 }).notNull(),
    wrappedDek: binary("wrapped_dek").notNull(),
    wrapNonce: binary("wrap_nonce").notNull(),
    keyProvider: varchar("key_provider", { length: 64 }).notNull(),
    kekVersion: varchar("kek_version", { length: 128 }).notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("source_secrets_kek_version_idx").on(table.kekVersion)],
);

export const works = pgTable(
  "works",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    canonicalTitle: text("canonical_title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("works_normalized_title_idx").on(table.normalizedTitle)],
);

export const sourceTitles = pgTable(
  "source_titles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "restrict" }),
    workId: uuid("work_id").references(() => works.id, {
      onDelete: "set null",
    }),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    url: text("url").notNull(),
    metadata: jsonb("metadata").$type<SourceMetadata>().default({}).notNull(),
    remoteUpdatedAt: timestampColumn("remote_updated_at"),
    firstSeenAt: timestampColumn("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestampColumn("last_seen_at").defaultNow().notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("source_titles_source_external_uq").on(
      table.sourceId,
      table.externalId,
    ),
    index("source_titles_work_id_idx").on(table.workId),
    index("source_titles_normalized_title_idx").on(table.normalizedTitle),
  ],
);

export const userLibrary = pgTable(
  "user_library",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workId: uuid("work_id")
      .notNull()
      .references(() => works.id, { onDelete: "cascade" }),
    status: libraryStatus("status").default("unknown").notNull(),
    firstAddedAt: timestampColumn("first_added_at").defaultNow().notNull(),
    lastSeenAt: timestampColumn("last_seen_at").defaultNow().notNull(),
    archivedAt: timestampColumn("archived_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("user_library_user_work_uq").on(table.userId, table.workId),
    index("user_library_user_status_idx").on(table.userId, table.status),
  ],
);

export const sourceProgress = pgTable(
  "source_progress",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceConnectionId: uuid("source_connection_id")
      .notNull()
      .references(() => sourceConnections.id, { onDelete: "cascade" }),
    sourceTitleId: uuid("source_title_id")
      .notNull()
      .references(() => sourceTitles.id, { onDelete: "cascade" }),
    semantics: progressSemantics("semantics").default("unknown").notNull(),
    lastChapterExternalId: text("last_chapter_external_id"),
    lastChapterLabel: text("last_chapter_label"),
    lastChapterNumber: numeric("last_chapter_number", {
      precision: 16,
      scale: 6,
    }),
    lastVolume: numeric("last_volume", { precision: 12, scale: 4 }),
    lastPart: text("last_part"),
    readChapters: jsonb("read_chapters")
      .$type<ReadChapterMarker[]>()
      .default([])
      .notNull(),
    readCount: integer("read_count"),
    totalCount: integer("total_count"),
    completed: boolean("completed").default(false).notNull(),
    evidenceHash: varchar("evidence_hash", { length: 128 }),
    remoteUpdatedAt: timestampColumn("remote_updated_at"),
    observedAt: timestampColumn("observed_at").defaultNow().notNull(),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("source_progress_connection_title_uq").on(
      table.sourceConnectionId,
      table.sourceTitleId,
    ),
    index("source_progress_title_id_idx").on(table.sourceTitleId),
    check(
      "source_progress_non_negative_counts",
      sql`(${table.readCount} is null or ${table.readCount} >= 0) and (${table.totalCount} is null or ${table.totalCount} >= 0)`,
    ),
  ],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceConnectionId: uuid("source_connection_id")
      .notNull()
      .references(() => sourceConnections.id, { onDelete: "cascade" }),
    trigger: syncRunTrigger("trigger").notNull(),
    status: syncRunStatus("status").default("queued").notNull(),
    discoveredCount: integer("discovered_count").default(0).notNull(),
    importedCount: integer("imported_count").default(0).notNull(),
    updatedCount: integer("updated_count").default(0).notNull(),
    skippedCount: integer("skipped_count").default(0).notNull(),
    failedCount: integer("failed_count").default(0).notNull(),
    safeErrorCode: varchar("safe_error_code", { length: 128 }),
    safeErrorMessage: text("safe_error_message"),
    startedAt: timestampColumn("started_at"),
    finishedAt: timestampColumn("finished_at"),
    createdAt: timestampColumn("created_at").defaultNow().notNull(),
    updatedAt: timestampColumn("updated_at")
      .defaultNow()
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("sync_runs_connection_created_idx").on(
      table.sourceConnectionId,
      table.createdAt,
    ),
    index("sync_runs_status_idx").on(table.status),
    check(
      "sync_runs_non_negative_counts",
      sql`${table.discoveredCount} >= 0 and ${table.importedCount} >= 0 and ${table.updatedCount} >= 0 and ${table.skippedCount} >= 0 and ${table.failedCount} >= 0`,
    ),
  ],
);

export const sourceRelations = relations(sources, ({ many }) => ({
  connections: many(sourceConnections),
  titles: many(sourceTitles),
}));

export const sourceConnectionRelations = relations(
  sourceConnections,
  ({ many, one }) => ({
    source: one(sources, {
      fields: [sourceConnections.sourceId],
      references: [sources.id],
    }),
    user: one(user, {
      fields: [sourceConnections.userId],
      references: [user.id],
    }),
    secret: one(sourceSecrets),
    progress: many(sourceProgress),
    syncRuns: many(syncRuns),
  }),
);

export const sourceSecretRelations = relations(sourceSecrets, ({ one }) => ({
  connection: one(sourceConnections, {
    fields: [sourceSecrets.sourceConnectionId],
    references: [sourceConnections.id],
  }),
}));

export const workRelations = relations(works, ({ many }) => ({
  sourceTitles: many(sourceTitles),
  libraryEntries: many(userLibrary),
}));

export const sourceTitleRelations = relations(
  sourceTitles,
  ({ many, one }) => ({
    source: one(sources, {
      fields: [sourceTitles.sourceId],
      references: [sources.id],
    }),
    work: one(works, {
      fields: [sourceTitles.workId],
      references: [works.id],
    }),
    progress: many(sourceProgress),
  }),
);

export const userLibraryRelations = relations(userLibrary, ({ one }) => ({
  user: one(user, {
    fields: [userLibrary.userId],
    references: [user.id],
  }),
  work: one(works, {
    fields: [userLibrary.workId],
    references: [works.id],
  }),
}));

export const sourceProgressRelations = relations(sourceProgress, ({ one }) => ({
  connection: one(sourceConnections, {
    fields: [sourceProgress.sourceConnectionId],
    references: [sourceConnections.id],
  }),
  sourceTitle: one(sourceTitles, {
    fields: [sourceProgress.sourceTitleId],
    references: [sourceTitles.id],
  }),
}));

export const syncRunRelations = relations(syncRuns, ({ one }) => ({
  connection: one(sourceConnections, {
    fields: [syncRuns.sourceConnectionId],
    references: [sourceConnections.id],
  }),
}));

export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type SourceConnection = typeof sourceConnections.$inferSelect;
export type NewSourceConnection = typeof sourceConnections.$inferInsert;
export type SourceSecret = typeof sourceSecrets.$inferSelect;
export type NewSourceSecret = typeof sourceSecrets.$inferInsert;
export type Work = typeof works.$inferSelect;
export type NewWork = typeof works.$inferInsert;
export type SourceTitle = typeof sourceTitles.$inferSelect;
export type NewSourceTitle = typeof sourceTitles.$inferInsert;
export type UserLibraryEntry = typeof userLibrary.$inferSelect;
export type NewUserLibraryEntry = typeof userLibrary.$inferInsert;
export type SourceProgress = typeof sourceProgress.$inferSelect;
export type NewSourceProgress = typeof sourceProgress.$inferInsert;
export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
