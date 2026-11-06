-- A declared report against what the platform read during its shift (ADR 0073): the member's explanation of a gap,
-- who reviewed it (`human`, or the automatic check that only validates and names nobody), what its validation saw,
-- the agency's threshold, and when a read of the sales register last reached its end. Reviews written before keep a
-- null `review_kind`, read as a person's: the state check accepts them as they are, nothing is rewritten.
ALTER TABLE "shift_reports" DROP CONSTRAINT "shift_reports_texts_check";--> statement-breakpoint
ALTER TABLE "shift_reports" DROP CONSTRAINT "shift_reports_state_check";--> statement-breakpoint
ALTER TABLE "sales_feed_cursors" ADD COLUMN "caught_up_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "scheduling_settings" ADD COLUMN "report_gap_bps" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduling_settings" ADD COLUMN "report_gap_minor" integer DEFAULT 500 NOT NULL;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD COLUMN "review_kind" text;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD COLUMN "review_check" jsonb;--> statement-breakpoint
ALTER TABLE "scheduling_settings" ADD CONSTRAINT "scheduling_settings_report_gap_check" CHECK ("scheduling_settings"."report_gap_bps" between 0 and 10000 and "scheduling_settings"."report_gap_minor" between 0 and 100000);--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_explanation_check" CHECK ("shift_reports"."corrects_id" is null or "shift_reports"."explanation" is null);--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_review_kind_check" CHECK ("shift_reports"."review_kind" in ('human', 'automatic'));--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_review_seen_check" CHECK ("shift_reports"."review_check" is null or ("shift_reports"."status" = 'validated' and jsonb_typeof("shift_reports"."review_check") = 'object'));--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_texts_check" CHECK (coalesce(char_length("shift_reports"."comment"), 1) between 1 and 1000 and coalesce(char_length("shift_reports"."incident"), 1) between 1 and 1000 and coalesce(char_length("shift_reports"."review_note"), 1) between 1 and 500 and coalesce(char_length("shift_reports"."explanation"), 1) between 1 and 1000);--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_state_check" CHECK (("shift_reports"."status" = 'submitted') = ("shift_reports"."reviewed_at" is null) and ("shift_reports"."status" = 'rejected') = ("shift_reports"."review_note" is not null) and ("shift_reports"."review_kind" is null or "shift_reports"."reviewed_at" is not null) and case when "shift_reports"."review_kind" = 'automatic' then "shift_reports"."reviewed_by" is null and "shift_reports"."status" = 'validated' else ("shift_reports"."reviewed_at" is null) = ("shift_reports"."reviewed_by" is null) end);--> statement-breakpoint
ALTER POLICY "team_review" ON "shift_reports" TO public USING ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shift_reports"."status" = 'submitted') WITH CHECK ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shift_reports"."status" in ('validated', 'rejected') and "shift_reports"."reviewed_by" = nullif(current_setting('app.user_id', true), '') and "shift_reports"."review_kind" = 'human' and not exists (select 1 from team_members m where m.id = "shift_reports"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and (nullif(current_setting('app.team_scope', true), '') = 'owner' or "shift_reports"."submitted_by" <> nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
-- Written by hand (ADR 0073). A review never touches the member's explanation either, as it never touches the amount
-- or the texts: the trigger of 0026 takes `explanation` into what a review keeps. The rest of its rules is unchanged.
DROP TRIGGER "shift_reports_kept" ON "shift_reports";--> statement-breakpoint
CREATE TRIGGER "shift_reports_kept" BEFORE UPDATE ON "shift_reports" FOR EACH ROW
  WHEN (
    (OLD."id", OLD."creator_id", OLD."platform_account_id", OLD."shift_id", OLD."member_id", OLD."period",
     OLD."corrects_id", OLD."currency", OLD."by_agency", OLD."created_by", OLD."created_at")
    IS DISTINCT FROM
    (NEW."id", NEW."creator_id", NEW."platform_account_id", NEW."shift_id", NEW."member_id", NEW."period",
     NEW."corrects_id", NEW."currency", NEW."by_agency", NEW."created_by", NEW."created_at")
    OR NEW."version" <> OLD."version" + 1
    OR NOT (
      (OLD."status" = 'submitted' AND NEW."status" IN ('submitted', 'validated', 'rejected'))
      OR (OLD."status" = 'rejected' AND NEW."status" = 'submitted')
    )
    OR (NEW."status" <> 'submitted'
        AND (NEW."amount_minor", NEW."comment", NEW."incident", NEW."explanation", NEW."submitted_by",
             NEW."submitted_at")
            IS DISTINCT FROM
            (OLD."amount_minor", OLD."comment", OLD."incident", OLD."explanation", OLD."submitted_by",
             OLD."submitted_at"))
  )
  EXECUTE FUNCTION "refuse_pay_change"();
--> statement-breakpoint
-- The application writes the member's explanation, and a person's review with what it saw; the policies keep
-- `automatic` from it (`team_review` wants `human`), so only the job, as the admin role, validates in that name.
GRANT UPDATE ("review_kind", "explanation", "review_check") ON "shift_reports" TO nirvana_app;
