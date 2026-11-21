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
