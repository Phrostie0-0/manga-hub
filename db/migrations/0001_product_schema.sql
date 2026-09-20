CREATE TYPE "public"."source_adapter_status" AS ENUM ('active', 'degraded', 'disabled');
--> statement-breakpoint
CREATE TYPE "public"."source_connection_status" AS ENUM ('pending_auth', 'awaiting_user', 'validating', 'importing', 'active', 'reauth_required', 'needs_attention', 'rate_limited', 'degraded', 'disabled');
--> statement-breakpoint
CREATE TYPE "public"."library_status" AS ENUM ('unknown', 'planned', 'reading', 'on_hold', 'completed', 'dropped');
--> statement-breakpoint
CREATE TYPE "public"."progress_semantics" AS ENUM ('unknown', 'explicit_read_set', 'last_read', 'completed_only');
--> statement-breakpoint
CREATE TYPE "public"."sync_run_trigger" AS ENUM ('initial_import', 'manual', 'scheduled', 'full_reconcile');
--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM ('queued', 'running', 'succeeded', 'partial_failure', 'failed', 'cancelled');
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(64) NOT NULL,
	"name" text NOT NULL,
	"base_url" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"adapter_status" "source_adapter_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"source_id" uuid NOT NULL,
	"remote_account_id" text,
	"remote_display_name" text,
	"status" "source_connection_status" DEFAULT 'pending_auth' NOT NULL,
	"sync_enabled" boolean DEFAULT true NOT NULL,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"known_expires_at" timestamp with time zone,
	"sync_cursor" text,
	"next_sync_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_successful_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_connections_sync_interval_positive" CHECK ("source_connections"."sync_interval_minutes" > 0)
);
--> statement-breakpoint
CREATE TABLE "source_secrets" (
	"source_connection_id" uuid PRIMARY KEY NOT NULL,
	"format_version" smallint NOT NULL,
	"cipher" varchar(64) NOT NULL,
	"ciphertext" bytea NOT NULL,
	"payload_nonce" bytea NOT NULL,
	"wrap_cipher" varchar(64) NOT NULL,
	"wrapped_dek" bytea NOT NULL,
	"wrap_nonce" bytea NOT NULL,
	"key_provider" varchar(64) NOT NULL,
	"kek_version" varchar(128) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "works" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_titles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"work_id" uuid,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"url" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"remote_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_library" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"work_id" uuid NOT NULL,
	"status" "library_status" DEFAULT 'unknown' NOT NULL,
	"first_added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"source_title_id" uuid NOT NULL,
	"semantics" "progress_semantics" DEFAULT 'unknown' NOT NULL,
	"last_chapter_external_id" text,
	"last_chapter_label" text,
	"last_chapter_number" numeric(16, 6),
	"last_volume" numeric(12, 4),
	"last_part" text,
	"read_chapters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"read_count" integer,
	"total_count" integer,
	"completed" boolean DEFAULT false NOT NULL,
	"evidence_hash" varchar(128),
	"remote_updated_at" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_progress_non_negative_counts" CHECK (("source_progress"."read_count" is null or "source_progress"."read_count" >= 0) and ("source_progress"."total_count" is null or "source_progress"."total_count" >= 0))
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_connection_id" uuid NOT NULL,
	"trigger" "sync_run_trigger" NOT NULL,
	"status" "sync_run_status" DEFAULT 'queued' NOT NULL,
	"discovered_count" integer DEFAULT 0 NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"safe_error_code" varchar(128),
	"safe_error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_runs_non_negative_counts" CHECK ("sync_runs"."discovered_count" >= 0 and "sync_runs"."imported_count" >= 0 and "sync_runs"."updated_count" >= 0 and "sync_runs"."skipped_count" >= 0 and "sync_runs"."failed_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_secrets" ADD CONSTRAINT "source_secrets_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_titles" ADD CONSTRAINT "source_titles_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_titles" ADD CONSTRAINT "source_titles_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_library" ADD CONSTRAINT "user_library_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_progress" ADD CONSTRAINT "source_progress_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_progress" ADD CONSTRAINT "source_progress_source_title_id_source_titles_id_fk" FOREIGN KEY ("source_title_id") REFERENCES "public"."source_titles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_source_connection_id_source_connections_id_fk" FOREIGN KEY ("source_connection_id") REFERENCES "public"."source_connections"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "sources_code_uq" ON "sources" USING btree ("code");
--> statement-breakpoint
CREATE UNIQUE INDEX "source_connections_user_source_remote_account_uq" ON "source_connections" USING btree ("user_id", "source_id", "remote_account_id") WHERE "source_connections"."remote_account_id" is not null;
--> statement-breakpoint
CREATE INDEX "source_connections_user_id_idx" ON "source_connections" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "source_connections_source_id_idx" ON "source_connections" USING btree ("source_id");
--> statement-breakpoint
CREATE INDEX "source_connections_due_sync_idx" ON "source_connections" USING btree ("next_sync_at") WHERE "source_connections"."sync_enabled" = true;
--> statement-breakpoint
CREATE INDEX "source_secrets_kek_version_idx" ON "source_secrets" USING btree ("kek_version");
--> statement-breakpoint
CREATE INDEX "works_normalized_title_idx" ON "works" USING btree ("normalized_title");
--> statement-breakpoint
CREATE UNIQUE INDEX "source_titles_source_external_uq" ON "source_titles" USING btree ("source_id", "external_id");
--> statement-breakpoint
CREATE INDEX "source_titles_work_id_idx" ON "source_titles" USING btree ("work_id");
--> statement-breakpoint
CREATE INDEX "source_titles_normalized_title_idx" ON "source_titles" USING btree ("normalized_title");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_library_user_work_uq" ON "user_library" USING btree ("user_id", "work_id");
--> statement-breakpoint
CREATE INDEX "user_library_user_status_idx" ON "user_library" USING btree ("user_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "source_progress_connection_title_uq" ON "source_progress" USING btree ("source_connection_id", "source_title_id");
--> statement-breakpoint
CREATE INDEX "source_progress_title_id_idx" ON "source_progress" USING btree ("source_title_id");
--> statement-breakpoint
CREATE INDEX "sync_runs_connection_created_idx" ON "sync_runs" USING btree ("source_connection_id", "created_at");
--> statement-breakpoint
CREATE INDEX "sync_runs_status_idx" ON "sync_runs" USING btree ("status");
