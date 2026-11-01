-- ADR 0038 (accepted by Charles, 31/10): a positive total under the payout minimum is carried twice at most, the
-- third period pays it even under the minimum, so that its invoice is paid before its due date.
-- `carry_overs.rank`: how many times in a row a positive amount has been carried, this one included (1, then 2); always
-- 1 for a negative one, which starts the count again. Added with a default of 1: a carry-over written before is a
-- first one, as the ADR says.
-- `keep_carry_over` checks the rank against the member's carry-over into `from_period` (one at most: unique on
-- `(member_id, from_period)`, and `to_period` is the next period): the one before plus one when both are positive,
-- otherwise 1. A third positive carry-over in a row would be rank 3, which the CHECK refuses: the
-- base, not only the engine, keeps the third period paying.
-- A positive carry-over taken over from Imperium (EQ-07, nothing imported yet) is to be paid by the first period of
-- Nirvana (ADR 0038: Imperium did not count its carry-overs in a row), so it goes in at rank 2. This trigger refuses
-- that today, as it refuses any carry-over without a validated statement of Nirvana: the import's own migration
-- adapts it to the rows it imports.
-- An invoice falls due 45 to 60 days after its issue: under 45, the third period's payout could come after the due
-- date of the first invoice (ADR 0038). Narrower; nothing is deployed, and no `billing_settings` row exists (nothing
-- writes it before EQ-06 lot 8).
ALTER TABLE "billing_settings" DROP CONSTRAINT "billing_settings_delays_check";--> statement-breakpoint
ALTER TABLE "carry_overs" ADD COLUMN "rank" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_delays_check" CHECK ("billing_settings"."due_days" between 45 and 60 and "billing_settings"."document_reminder_days" between 1 and 120);--> statement-breakpoint
ALTER TABLE "carry_overs" ADD CONSTRAINT "carry_overs_rank_check" CHECK ("carry_overs"."rank" between 1 and 2 and ("carry_overs"."rank" = 1 or "carry_overs"."amount_minor" > 0));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "keep_carry_over"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."to_period" <> "next_pay_period"(NEW."from_period") OR NOT EXISTS (
    SELECT 1 FROM "commission_statements" s
    WHERE s."id" = NEW."statement_id" AND s."member_id" = NEW."member_id" AND s."period" = NEW."from_period"
      AND s."status" = 'validated' AND s."carry_over_out_minor" = NEW."amount_minor"
  ) THEN
    RAISE EXCEPTION 'a carry-over is what its member''s validated statement carried, to the next period (EQ-04)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."rank" <> (CASE WHEN NEW."amount_minor" > 0 THEN coalesce((
    SELECT p."rank" + 1 FROM "carry_overs" p
    WHERE p."member_id" = NEW."member_id" AND p."to_period" = NEW."from_period" AND p."amount_minor" > 0
  ), 1) ELSE 1 END) THEN
    RAISE EXCEPTION 'a carry-over is what its member''s validated statement carried, at the rank that follows (ADR 0038)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
