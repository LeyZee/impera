-- The cadence of her scripts (SC-02, ADR 0056 § 2). Additive. `script_cadences`: every how many days a script is asked
-- of each creator (14 without a row) and what the hourly job `scripts.ask_scripts` last found; under her RLS and the
-- team's scopes (the owner writes `days`, the owner and the active managers read), closed to her account, never deleted
-- by the application. `content_requests.structure_version_id`: the version frozen for a script asked by the cadence,
-- whose requests are one per creator and due day (`content_requests_cadence_unique`), so that a replay asks nothing twice.
CREATE TABLE "script_cadences" (
	"creator_id" uuid PRIMARY KEY NOT NULL,
	"days" smallint DEFAULT 14 NOT NULL,
	"outcome" text,
	"skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"checked_at" timestamp with time zone,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_cadences_days_check" CHECK ("script_cadences"."days" between 1 and 90),
	CONSTRAINT "script_cadences_skipped_check" CHECK (jsonb_typeof("script_cadences"."skipped") = 'array'),
	CONSTRAINT "script_cadences_checked_check" CHECK (("script_cadences"."outcome" is null) = ("script_cadences"."checked_at" is null)),
	CONSTRAINT "script_cadences_outcome_check" CHECK ("script_cadences"."outcome" in ('asked', 'reused', 'queue_empty', 'no_persona', 'blocked'))
);
--> statement-breakpoint
ALTER TABLE "script_cadences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "script_cadences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "script_cadences" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "script_cadences" TO nirvana_app;--> statement-breakpoint
ALTER TABLE "content_requests" ADD COLUMN "structure_version_id" uuid;--> statement-breakpoint
ALTER TABLE "script_cadences" ADD CONSTRAINT "script_cadences_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_cadences" ADD CONSTRAINT "script_cadences_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_structure_version_id_script_structure_versions_id_fk" FOREIGN KEY ("structure_version_id") REFERENCES "public"."script_structure_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "content_requests_cadence_unique" ON "content_requests" USING btree ("creator_id","due_on") WHERE "content_requests"."origin" = 'cadence';--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_structure_version_check" CHECK ("content_requests"."structure_version_id" is null or "content_requests"."structure_id" is not null);--> statement-breakpoint
CREATE POLICY "team_read" ON "script_cadences" AS PERMISSIVE FOR SELECT TO public USING ("script_cadences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "script_cadences" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("script_cadences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "script_cadences"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "script_cadences" AS PERMISSIVE FOR UPDATE TO public USING ("script_cadences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK ("script_cadences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "script_cadences"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "script_cadences" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');