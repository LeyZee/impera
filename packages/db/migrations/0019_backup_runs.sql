-- The daily encrypted export outside Neon (ADR 0028, OPS-02). Additive. backup_runs is written by the `backup` service
-- alone, with the admin role; restore_tests by the owner through the API (the route checks the role, not the
-- database). Out of RLS: no tenant data.
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"error" text,
	"object_key" text,
	"size_bytes" bigint,
	"sha256" text,
	"pg_dump_version" text,
	"row_counts" jsonb,
	CONSTRAINT "backup_runs_status_check" CHECK ("backup_runs"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "backup_runs_error_check" CHECK (char_length("backup_runs"."error") <= 500),
	CONSTRAINT "backup_runs_sha256_check" CHECK ("backup_runs"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "backup_runs_row_counts_check" CHECK ("backup_runs"."row_counts" is null or jsonb_typeof("backup_runs"."row_counts") = 'object'),
	CONSTRAINT "backup_runs_succeeded_check" CHECK ("backup_runs"."status" <> 'succeeded' or ("backup_runs"."finished_at" is not null and "backup_runs"."sha256" is not null and "backup_runs"."size_bytes" is not null and "backup_runs"."row_counts" is not null)),
	CONSTRAINT "backup_runs_failed_check" CHECK ("backup_runs"."status" <> 'failed' or "backup_runs"."finished_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "restore_tests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"backup_run_id" uuid NOT NULL,
	"tested_at" timestamp with time zone NOT NULL,
	"duration_seconds" integer NOT NULL,
	"row_count_mismatches" integer NOT NULL,
	"notes" text,
	"entered_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "restore_tests_duration_check" CHECK ("restore_tests"."duration_seconds" > 0),
	CONSTRAINT "restore_tests_mismatches_check" CHECK ("restore_tests"."row_count_mismatches" >= 0),
	CONSTRAINT "restore_tests_notes_check" CHECK (char_length("restore_tests"."notes") <= 500)
);
--> statement-breakpoint
ALTER TABLE "restore_tests" ADD CONSTRAINT "restore_tests_backup_run_id_backup_runs_id_fk" FOREIGN KEY ("backup_run_id") REFERENCES "public"."backup_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restore_tests" ADD CONSTRAINT "restore_tests_entered_by_user_id_user_id_fk" FOREIGN KEY ("entered_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "backup_runs_sha256_idx" ON "backup_runs" USING btree ("sha256");--> statement-breakpoint
CREATE INDEX "backup_runs_status_finished_at_idx" ON "backup_runs" USING btree ("status","finished_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "restore_tests_backup_run_id_idx" ON "restore_tests" USING btree ("backup_run_id");--> statement-breakpoint
-- Added by hand after `drizzle-kit generate`: the default privileges of init.sql would grant everything in development,
-- and Neon has none. The application reads the runs, never writes them.
REVOKE ALL ON "backup_runs" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "backup_runs" TO nirvana_app;--> statement-breakpoint
-- A restore test is a fact of the past: entered once, never edited nor deleted, not even by the admin role.
REVOKE ALL ON "restore_tests" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "restore_tests" TO nirvana_app;--> statement-breakpoint
CREATE TRIGGER "restore_tests_append_only" BEFORE UPDATE OR DELETE ON "restore_tests"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();
