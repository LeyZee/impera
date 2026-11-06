-- A departed member's final statement (ADR 0072): the fortnight of his departure is his final one, validated at the
-- normal cycle even while one of his documents is still open (a contest's correction goes on his next open fortnight),
-- and a final statement below zero writes its balance off instead of carrying it. Existing statements all keep
-- written_off_minor = 0, which both checks accept; a validated statement is never computed again.
ALTER TABLE "commission_statements" DROP CONSTRAINT "commission_statements_amounts_check";--> statement-breakpoint
ALTER TABLE "commission_statements" ADD COLUMN "written_off_minor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_written_off_check" CHECK ("commission_statements"."written_off_minor" = 0 or (coalesce(("commission_statements"."rules" ->> 'final')::boolean, false) and "commission_statements"."total_minor" < 0 and "commission_statements"."written_off_minor" = "commission_statements"."total_minor" and "commission_statements"."carry_over_out_minor" = 0));--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_amounts_check" CHECK ("commission_statements"."payable_minor" >= 0 and "commission_statements"."payable_minor" = "commission_statements"."total_minor" - "commission_statements"."carry_over_out_minor" - "commission_statements"."written_off_minor" and "commission_statements"."penalties_minor" between 0 and greatest("commission_statements"."penalties_requested_minor", 0));--> statement-breakpoint
-- From the fortnight that holds his departure day on, a statement of his is final; a final statement belongs to a member
-- who left. His open documents no longer hold it back (ADR 0072 § 3): `member_documents_open` stays for whoever reads it.
CREATE OR REPLACE FUNCTION "keep_final_statement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  departure date;
  final boolean := coalesce((NEW."rules" ->> 'final')::boolean, false);
BEGIN
  SELECT "pay_period_of"(m."left_on") INTO departure
  FROM "team_members" m WHERE m."id" = NEW."member_id";
  IF departure IS NOT NULL AND NEW."period" >= departure THEN
    IF NOT final THEN
      RAISE EXCEPTION 'statement % of a member who left is final from the fortnight of his departure on: compute it again (ADR 0072)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF final THEN
    RAISE EXCEPTION 'statement % is final, but only a member who left has final statements, from the fortnight of his departure on (ADR 0072)', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
