-- « À refaire » (trou 7 du 21/11, validé par Charles): the agency withdraws a drop with a sentence for her; her request
-- opens again and her screen shows the sentence. Additive: nothing existing has one. The team writes it with the
-- withdrawal (its column grant); she never writes it, whatever her policies let her update.
-- A blocked drop could not be withdrawn: the check wanted its reason gone, her guard forbids clearing it. A withdrawn
-- drop now keeps its reason.
ALTER TABLE "content_drops" ADD COLUMN "redo_sentence" text;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_redo_check" CHECK ("content_drops"."redo_sentence" is null or ("content_drops"."state" = 'withdrawn' and char_length("content_drops"."redo_sentence") between 1 and 200));--> statement-breakpoint
ALTER TABLE "content_drops" DROP CONSTRAINT "content_drops_blocked_check";--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_blocked_check" CHECK (("content_drops"."state" <> 'blocked' or "content_drops"."blocked_reason" is not null)
        and ("content_drops"."blocked_reason" is null or "content_drops"."state" in ('blocked', 'withdrawn'))
        and coalesce(char_length("content_drops"."blocked_reason"), 1) between 1 and 200);--> statement-breakpoint
GRANT UPDATE ("redo_sentence") ON "content_drops" TO nirvana_app;--> statement-breakpoint
CREATE FUNCTION "guard_content_drop_redo"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.account_role', true) = 'creator'
     AND NEW."redo_sentence" IS DISTINCT FROM OLD."redo_sentence" THEN
    RAISE EXCEPTION 'only her team asks a drop again' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_drops_redo_guarded" BEFORE UPDATE ON "content_drops" FOR EACH ROW
  EXECUTE FUNCTION "guard_content_drop_redo"();
--> statement-breakpoint
-- « À refaire » on one medium alone (coffre, 21/11): the drop stays, she replaces that medium where it is. A replaced
-- file is no longer a script's alone: the slot check stops asking it.
ALTER TABLE "content_drop_files" ADD COLUMN "redo_sentence" text;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD COLUMN "redo_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD COLUMN "redo_by" text;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_redo_by_user_id_fk" FOREIGN KEY ("redo_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_redo_check" CHECK (("content_drop_files"."redo_sentence" is null) = ("content_drop_files"."redo_at" is null) and ("content_drop_files"."redo_at" is null) = ("content_drop_files"."redo_by" is null)
        and coalesce(char_length("content_drop_files"."redo_sentence"), 1) between 1 and 200);--> statement-breakpoint
ALTER TABLE "content_drop_files" DROP CONSTRAINT "content_drop_files_slot_check";--> statement-breakpoint
ALTER TABLE "content_drop_files" ADD CONSTRAINT "content_drop_files_slot_check" CHECK (("content_drop_files"."slot_key" is null or char_length("content_drop_files"."slot_key") between 4 and 40)
        and ("content_drop_files"."min_seconds" is null) = ("content_drop_files"."max_seconds" is null)
        and ("content_drop_files"."min_seconds" is null or ("content_drop_files"."slot_key" is not null and "content_drop_files"."min_seconds" between 1 and "content_drop_files"."max_seconds")));--> statement-breakpoint
CREATE POLICY "team_redo" ON "content_drop_files" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drop_files"."replaced_at" is null and exists (
        select 1 from content_drops d where d.id = "content_drop_files"."drop_id" and d.creator_id = "content_drop_files"."creator_id"
          and d.state in ('received', 'ready', 'blocked') and (d.exported_at is null or d.category = 'script')
      )) WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drop_files"."replaced_at" is null);--> statement-breakpoint
GRANT UPDATE ("redo_sentence", "redo_at", "redo_by") ON "content_drop_files" TO nirvana_app;--> statement-breakpoint
GRANT INSERT ON "content_drop_files" TO impera_service;--> statement-breakpoint
CREATE FUNCTION "guard_content_drop_file_redo"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('app.account_role', true) = 'creator'
     AND (NEW."redo_sentence" IS DISTINCT FROM OLD."redo_sentence" OR NEW."redo_at" IS DISTINCT FROM OLD."redo_at"
       OR NEW."redo_by" IS DISTINCT FROM OLD."redo_by") THEN
    RAISE EXCEPTION 'only her team asks a medium again' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_drop_files_redo_guarded" BEFORE UPDATE ON "content_drop_files" FOR EACH ROW
  EXECUTE FUNCTION "guard_content_drop_file_redo"();
--> statement-breakpoint
-- A script copied into Reveal whose medium she replaced is to copy again (Charles, 21/11): the server's own role takes
-- its confirmation back, in that transaction only (`app.export_reset`); her account and her team never do.
CREATE OR REPLACE FUNCTION "guard_content_drop_export"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."exported_at" IS DISTINCT FROM OLD."exported_at" OR NEW."exported_by" IS DISTINCT FROM OLD."exported_by" THEN
    IF NEW."exported_at" IS NULL AND NEW."exported_by" IS NULL AND NEW."category" = 'script'
       AND current_setting('app.export_reset', true) = 'on'
       AND current_user <> 'nirvana_app'
       AND coalesce(current_setting('app.account_role', true), '') = ''
       AND coalesce(current_setting('app.team_scope', true), '') = '' THEN
      RETURN NEW;
    END IF;
    IF OLD."exported_at" IS NOT NULL OR current_setting('app.account_role', true) = 'creator' THEN
      RAISE EXCEPTION 'an export is confirmed once, by the team (SC-03)' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
