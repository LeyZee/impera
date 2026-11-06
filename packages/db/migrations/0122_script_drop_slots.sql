-- Her script, filled slot by slot (SC-02 lot b, ADR 0056 § 4). Additive. A script drop may begin empty in the state
-- `filling`; each file names its slot (`slot_key`) and, for a video slot, its lengths; a file replaced before she sends
-- her script keeps its row with `replaced_at`, out of the unique place and slot of the live ones. The application role
-- updates no column of a file but `replaced_at` (and `updated_at`): only the job moves a file's state. A script the
-- agency asks by hand names a frozen version of its structure.
ALTER TABLE "content_drop_files" DROP CONSTRAINT "content_drop_files_position_unique";--> statement-breakpoint
ALTER TABLE "content_drop_files" DROP CONSTRAINT "content_drop_files_position_check";--> statement-breakpoint
ALTER TABLE "content_drops" DROP CONSTRAINT "content_drops_state_check";--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD COLUMN "slot_key" text;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD COLUMN "min_seconds" smallint;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD COLUMN "max_seconds" smallint;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD COLUMN "replaced_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "content_drop_files_position_unique" ON "content_drop_files" USING btree ("drop_id","position") WHERE "content_drop_files"."replaced_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "content_drop_files_slot_unique" ON "content_drop_files" USING btree ("drop_id","slot_key") WHERE "content_drop_files"."slot_key" is not null and "content_drop_files"."replaced_at" is null;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_slot_check" CHECK (("content_drop_files"."slot_key" is null or char_length("content_drop_files"."slot_key") between 4 and 40)
        and ("content_drop_files"."min_seconds" is null) = ("content_drop_files"."max_seconds" is null)
        and ("content_drop_files"."min_seconds" is null or ("content_drop_files"."slot_key" is not null and "content_drop_files"."min_seconds" between 1 and "content_drop_files"."max_seconds"))
        and ("content_drop_files"."replaced_at" is null or "content_drop_files"."slot_key" is not null));--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_position_check" CHECK ("content_drop_files"."position" between 0 and 999);--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_state_check" CHECK ("content_drops"."state" in ('filling', 'uploading', 'received', 'ready', 'scheduled', 'published', 'blocked', 'withdrawn'));--> statement-breakpoint
CREATE POLICY "creator_replace" ON "content_drop_files" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drop_files"."slot_key" is not null and "content_drop_files"."replaced_at" is null and exists (
        select 1 from content_drops d where d.id = "content_drop_files"."drop_id" and d.creator_id = "content_drop_files"."creator_id" and d.state = 'filling'
      )) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drop_files"."replaced_at" is not null);--> statement-breakpoint
ALTER POLICY "creator_insert" ON "content_drop_files" TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drop_files"."state" = 'awaiting' and "content_drop_files"."replaced_at" is null and exists (
        select 1 from content_drops d where d.id = "content_drop_files"."drop_id" and d.creator_id = "content_drop_files"."creator_id"
          and d.state in ('uploading', 'filling')
      ));--> statement-breakpoint
ALTER POLICY "creator_insert" ON "content_drops" TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."created_by" = nullif(current_setting('app.user_id', true), '')
        and ("content_drops"."state" = 'uploading' or ("content_drops"."state" = 'filling' and "content_drops"."category" = 'script'))
        and "content_drops"."corrected_from" is null and ("content_drops"."request_id" is null or exists (
          select 1 from content_requests r
           where r.id = "content_drops"."request_id" and r.creator_id = "content_drops"."creator_id" and r.state = 'open' and r.category = "content_drops"."category"
        )));--> statement-breakpoint
ALTER POLICY "creator_withdraw" ON "content_drops" TO public USING (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."state" in ('filling', 'uploading', 'received', 'ready', 'blocked')) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."state" = 'withdrawn' and "content_drops"."withdrawn_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER POLICY "team_insert" ON "content_requests" TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_requests"."origin" = 'agency' and "content_requests"."created_by" = nullif(current_setting('app.user_id', true), '')
        and ("content_requests"."structure_id" is null or exists (
          select 1 from script_structures s
           where s.id = "content_requests"."structure_id" and s.archived_at is null
             and (s.reserved_creator_id is null or s.reserved_creator_id = "content_requests"."creator_id")
        ))
        and ("content_requests"."structure_version_id" is null or exists (
          select 1 from script_structure_versions v
           where v.id = "content_requests"."structure_version_id" and v.structure_id = "content_requests"."structure_id" and v.frozen_at is not null
        )));--> statement-breakpoint
REVOKE UPDATE ON "content_drop_files" FROM nirvana_app;--> statement-breakpoint
GRANT UPDATE ("replaced_at", "updated_at") ON "content_drop_files" TO nirvana_app;
