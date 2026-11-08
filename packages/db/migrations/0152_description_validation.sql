-- ADR 0030 § 3 (amended 08/11/2026) and ADR 0083 § 7: a drop's description and a script's synthesis are validated by
-- the account of the person who validates (`user.id`: the owner, an active manager or her), on a precise row. A
-- correction is a new row, validated as it is written; validating a row stamps it once, and that stamp is the only
-- change either table takes, for every role, the admin's included (`refuse_description_change`). nirvana_app may
-- update the two columns of the stamp and nothing else.
ALTER TABLE "script_drop_summaries" ADD COLUMN "validated_by" text;--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "validated_by" text;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD CONSTRAINT "script_drop_summaries_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD CONSTRAINT "script_drop_summaries_validated_check" CHECK (("script_drop_summaries"."validated_by" is null) = ("script_drop_summaries"."validated_at" is null));--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_validated_check" CHECK (("media_descriptions"."validated_by" is null) = ("media_descriptions"."validated_at" is null));--> statement-breakpoint
CREATE POLICY "team_validate" ON "script_drop_summaries" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "script_drop_summaries"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "script_drop_summaries"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
REVOKE UPDATE ON "media_descriptions", "script_drop_summaries" FROM nirvana_app;--> statement-breakpoint
GRANT UPDATE ("validated_by", "validated_at") ON "media_descriptions", "script_drop_summaries" TO nirvana_app;--> statement-breakpoint
CREATE FUNCTION "refuse_description_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."validated_at" IS NOT NULL OR NEW."validated_at" IS NULL
     OR (to_jsonb(NEW) - 'validated_by' - 'validated_at') IS DISTINCT FROM (to_jsonb(OLD) - 'validated_by' - 'validated_at') THEN
    RAISE EXCEPTION 'this change to % is refused: a row is written once, then validated once (ADR 0030 § 3)', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "media_descriptions_kept" BEFORE UPDATE ON "media_descriptions" FOR EACH ROW
  EXECUTE FUNCTION "refuse_description_change"();--> statement-breakpoint
CREATE TRIGGER "script_drop_summaries_kept" BEFORE UPDATE ON "script_drop_summaries" FOR EACH ROW
  EXECUTE FUNCTION "refuse_description_change"();
