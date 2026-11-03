CREATE TABLE "content_drop_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"drop_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" bigint NOT NULL,
	"state" text DEFAULT 'awaiting' NOT NULL,
	"refusal" text,
	"media_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_drop_files_position_unique" UNIQUE("drop_id","position"),
	CONSTRAINT "content_drop_files_kind_check" CHECK ("content_drop_files"."kind" in ('image', 'video', 'audio')),
	CONSTRAINT "content_drop_files_mime_check" CHECK ("content_drop_files"."mime" in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a')),
	CONSTRAINT "content_drop_files_state_check" CHECK ("content_drop_files"."state" in ('awaiting', 'kept', 'refused', 'duplicate')),
	CONSTRAINT "content_drop_files_position_check" CHECK ("content_drop_files"."position" between 0 and 59),
	CONSTRAINT "content_drop_files_bytes_check" CHECK ("content_drop_files"."bytes" > 0),
	CONSTRAINT "content_drop_files_refusal_check" CHECK (("content_drop_files"."state" = 'refused') = ("content_drop_files"."refusal" is not null) and coalesce(char_length("content_drop_files"."refusal"), 1) between 1 and 200),
	CONSTRAINT "content_drop_files_media_check" CHECK (("content_drop_files"."state" in ('kept', 'duplicate')) = ("content_drop_files"."media_asset_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "content_drop_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_drops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"category" text NOT NULL,
	"corrected_from" text,
	"corrected_by" text,
	"corrected_at" timestamp with time zone,
	"sentence" text,
	"state" text DEFAULT 'uploading' NOT NULL,
	"blocked_reason" text,
	"request_id" uuid,
	"created_by" text NOT NULL,
	"withdrawn_by" text,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_drops_creator_unique" UNIQUE("id","creator_id"),
	CONSTRAINT "content_drops_category_check" CHECK ("content_drops"."category" in ('feed_shoot', 'feed_video', 'script', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post')),
	CONSTRAINT "content_drops_corrected_from_check" CHECK ("content_drops"."corrected_from" in ('feed_shoot', 'feed_video', 'script', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post')),
	CONSTRAINT "content_drops_state_check" CHECK ("content_drops"."state" in ('uploading', 'received', 'ready', 'scheduled', 'published', 'blocked', 'withdrawn')),
	CONSTRAINT "content_drops_sentence_check" CHECK ("content_drops"."sentence" is null or char_length("content_drops"."sentence") between 1 and 200),
	CONSTRAINT "content_drops_blocked_check" CHECK (("content_drops"."state" = 'blocked') = ("content_drops"."blocked_reason" is not null)
        and coalesce(char_length("content_drops"."blocked_reason"), 1) between 1 and 200),
	CONSTRAINT "content_drops_correction_check" CHECK (("content_drops"."corrected_from" is null) = ("content_drops"."corrected_at" is null) and ("content_drops"."corrected_from" is null) = ("content_drops"."corrected_by" is null)
        and "content_drops"."corrected_from" is distinct from "content_drops"."category"),
	CONSTRAINT "content_drops_withdrawn_check" CHECK (("content_drops"."state" = 'withdrawn') = ("content_drops"."withdrawn_at" is not null)
        and ("content_drops"."withdrawn_at" is null) = ("content_drops"."withdrawn_by" is null)),
	CONSTRAINT "content_drops_script_check" CHECK ("content_drops"."category" <> 'script' or "content_drops"."request_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "content_drops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "content_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"category" text NOT NULL,
	"due_on" date NOT NULL,
	"reason" text NOT NULL,
	"structure_id" uuid,
	"origin" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"refusal_reason" text,
	"decided_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_requests_creator_unique" UNIQUE("id","creator_id"),
	CONSTRAINT "content_requests_category_check" CHECK ("content_requests"."category" in ('feed_shoot', 'feed_video', 'script', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post')),
	CONSTRAINT "content_requests_origin_check" CHECK ("content_requests"."origin" in ('agency', 'stock', 'cadence')),
	CONSTRAINT "content_requests_state_check" CHECK ("content_requests"."state" in ('open', 'refused', 'cancelled')),
	CONSTRAINT "content_requests_reason_check" CHECK (char_length("content_requests"."reason") between 1 and 160),
	CONSTRAINT "content_requests_structure_check" CHECK (("content_requests"."category" = 'script') = ("content_requests"."structure_id" is not null)),
	CONSTRAINT "content_requests_refusal_check" CHECK (("content_requests"."state" = 'open') = ("content_requests"."decided_at" is null)
        and ("content_requests"."refusal_reason" is null or ("content_requests"."state" = 'refused' and char_length("content_requests"."refusal_reason") between 1 and 200))),
	CONSTRAINT "content_requests_author_check" CHECK (("content_requests"."origin" = 'agency') = ("content_requests"."created_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "content_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_media_asset_id_media_assets_id_fk" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_drop_fk" FOREIGN KEY ("drop_id","creator_id") REFERENCES "public"."content_drops"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_corrected_by_user_id_fk" FOREIGN KEY ("corrected_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_request_fk" FOREIGN KEY ("request_id","creator_id") REFERENCES "public"."content_requests"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_structure_id_script_structures_id_fk" FOREIGN KEY ("structure_id") REFERENCES "public"."script_structures"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_drop_files_creator_idx" ON "content_drop_files" USING btree ("creator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "content_drops_request_live_unique" ON "content_drops" USING btree ("request_id") WHERE "content_drops"."request_id" is not null and "content_drops"."state" <> 'withdrawn';--> statement-breakpoint
CREATE INDEX "content_drops_creator_created_idx" ON "content_drops" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "content_requests_creator_due_idx" ON "content_requests" USING btree ("creator_id","due_on");--> statement-breakpoint
CREATE POLICY "creator_read" ON "content_drop_files" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "content_drop_files" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drop_files"."state" = 'awaiting' and exists (
        select 1 from content_drops d where d.id = "content_drop_files"."drop_id" and d.creator_id = "content_drop_files"."creator_id" and d.state = 'uploading'
      ));--> statement-breakpoint
CREATE POLICY "team_read" ON "content_drop_files" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_insert" ON "content_drop_files" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drop_files"."state" = 'awaiting' and exists (
        select 1 from content_drops d where d.id = "content_drop_files"."drop_id" and d.creator_id = "content_drop_files"."creator_id" and d.state = 'uploading'
      ));--> statement-breakpoint
CREATE POLICY "creator_read" ON "content_drops" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "content_drops" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."created_by" = nullif(current_setting('app.user_id', true), '') and "content_drops"."state" = 'uploading'
        and "content_drops"."corrected_from" is null and ("content_drops"."request_id" is null or exists (
          select 1 from content_requests r
           where r.id = "content_drops"."request_id" and r.creator_id = "content_drops"."creator_id" and r.state = 'open' and r.category = "content_drops"."category"
        )));--> statement-breakpoint
CREATE POLICY "creator_withdraw" ON "content_drops" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."state" in ('uploading', 'received', 'ready', 'blocked')) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."state" = 'withdrawn' and "content_drops"."withdrawn_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "content_drops" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_insert" ON "content_drops" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."created_by" = nullif(current_setting('app.user_id', true), '') and "content_drops"."state" = 'uploading');--> statement-breakpoint
CREATE POLICY "team_update" ON "content_drops" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."state" not in ('published', 'withdrawn')) WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_read" ON "content_requests" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_refuse" ON "content_requests" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_requests"."state" = 'open') WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_requests"."state" = 'refused');--> statement-breakpoint
CREATE POLICY "team_read" ON "content_requests" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_insert" ON "content_requests" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_requests"."origin" = 'agency' and "content_requests"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_update" ON "content_requests" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_requests"."state" = 'open') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_requests"."state" in ('open', 'cancelled'));--> statement-breakpoint
ALTER TABLE "content_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_drops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_drop_files" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- CR-06 (ADR 0044, ADR 0055): what each writer may change, the policies saying where. Her account withdraws a drop
-- (its state, who and when) and refuses a request (its state, her reason, when); the team corrects a category and
-- withdraws, cancels a request; nothing changes who a row belongs to, when it was made, nor what a request asked; a
-- withdrawn drop and a closed request never come back. For every role, the admin's included.
CREATE FUNCTION "guard_content_drop_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."creator_id" IS DISTINCT FROM OLD."creator_id"
     OR NEW."created_by" IS DISTINCT FROM OLD."created_by" OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
     OR NEW."request_id" IS DISTINCT FROM OLD."request_id" OR OLD."state" = 'withdrawn' THEN
    RAISE EXCEPTION 'this change to a content drop is refused (CR-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF current_setting('app.account_role', true) = 'creator'
     AND (NEW."category" IS DISTINCT FROM OLD."category" OR NEW."corrected_from" IS DISTINCT FROM OLD."corrected_from"
       OR NEW."corrected_by" IS DISTINCT FROM OLD."corrected_by" OR NEW."corrected_at" IS DISTINCT FROM OLD."corrected_at"
       OR NEW."sentence" IS DISTINCT FROM OLD."sentence" OR NEW."blocked_reason" IS DISTINCT FROM OLD."blocked_reason") THEN
    RAISE EXCEPTION 'a creator only withdraws her drop (CR-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF nullif(current_setting('app.team_scope', true), '') IS NOT NULL
     AND NEW."state" IS DISTINCT FROM OLD."state" AND NEW."state" <> 'withdrawn' THEN
    RAISE EXCEPTION 'the team only withdraws a drop, the job moves its states (CR-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_drops_guarded" BEFORE UPDATE ON "content_drops" FOR EACH ROW
  EXECUTE FUNCTION "guard_content_drop_change"();--> statement-breakpoint
CREATE FUNCTION "guard_content_request_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."creator_id" IS DISTINCT FROM OLD."creator_id"
     OR NEW."category" IS DISTINCT FROM OLD."category" OR NEW."structure_id" IS DISTINCT FROM OLD."structure_id"
     OR NEW."origin" IS DISTINCT FROM OLD."origin" OR NEW."created_by" IS DISTINCT FROM OLD."created_by"
     OR NEW."created_at" IS DISTINCT FROM OLD."created_at" OR OLD."state" <> 'open' THEN
    RAISE EXCEPTION 'this change to a content request is refused (CR-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF current_setting('app.account_role', true) = 'creator'
     AND (NEW."due_on" IS DISTINCT FROM OLD."due_on" OR NEW."reason" IS DISTINCT FROM OLD."reason") THEN
    RAISE EXCEPTION 'a creator only refuses a request (CR-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_requests_guarded" BEFORE UPDATE ON "content_requests" FOR EACH ROW
  EXECUTE FUNCTION "guard_content_request_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE or a DELETE would pass the policies).
REVOKE ALL ON "content_requests", "content_drops", "content_drop_files" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "content_requests", "content_drops", "content_drop_files" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("due_on", "reason", "state", "refusal_reason", "decided_at", "updated_at") ON "content_requests" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("category", "corrected_from", "corrected_by", "corrected_at", "state", "withdrawn_by", "withdrawn_at", "updated_at") ON "content_drops" TO nirvana_app;
