-- EQ-14 lot 1, ADR 0039 § 6: the day a member left, and what pay does with it. `left_on` is the day the owner made
-- him `left`, in the agency's zone, written by the server and never typed (like every « today » rule, the day itself is
-- checked in the code); the base keeps it with the status and never lets it move while he is gone (a return, which
-- EQ-14 plans, clears it with the status: the next departure has its own day). His closing fortnight is the
-- period after the one that holds `left_on`: from it on, each statement of his is final (no payout minimum) and is
-- validated only once none of his documents awaits an answer or stays contested.
ALTER TABLE "team_members" ADD COLUMN "left_on" date;--> statement-breakpoint
-- Nothing is deployed; a member made `left` before this migration (a development base) left on his last change.
UPDATE "team_members" SET "left_on" = ("updated_at" AT TIME ZONE 'Europe/Paris')::date WHERE "status" = 'left';--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_left_check" CHECK (("team_members"."status" = 'left') = ("team_members"."left_on" is not null));--> statement-breakpoint
CREATE FUNCTION "keep_member_departure"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."left_on" IS NOT NULL AND NEW."left_on" IS NOT NULL AND NEW."left_on" <> OLD."left_on" THEN
    RAISE EXCEPTION 'member % left on %, and that day never moves while he is gone (EQ-14)', OLD."id", OLD."left_on"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "team_members_departure_kept" BEFORE UPDATE OF "left_on" ON "team_members"
  FOR EACH ROW EXECUTE FUNCTION "keep_member_departure"();--> statement-breakpoint
-- The period that holds a day: the 1st to the 15th, then the 16th to the month's end. Date arithmetic only, never
-- through a timestamp and the session's time zone: the function is immutable for real.
CREATE FUNCTION "pay_period_of"(date) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT $1 - extract(day FROM $1)::integer + CASE WHEN extract(day FROM $1) >= 16 THEN 16 ELSE 1 END
$$;--> statement-breakpoint
-- A document of the member still open: issued, and neither answered for good (accepted, lapsed) nor, contested, ended.
CREATE FUNCTION "member_documents_open"(uuid) RETURNS integer LANGUAGE sql STABLE AS $$
  SELECT count(*)::integer FROM "invoices" i
  WHERE i."member_id" = $1 AND NOT EXISTS (
    SELECT 1 FROM "invoice_events" e
    WHERE e."invoice_id" = i."id" AND e."kind" IN ('accepted', 'lapsed', 'contest_upheld', 'contest_refused')
  )
$$;--> statement-breakpoint
CREATE FUNCTION "keep_final_statement"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  closing date;
  final boolean := coalesce((NEW."rules" ->> 'final')::boolean, false);
BEGIN
  SELECT "next_pay_period"("pay_period_of"(m."left_on")) INTO closing
  FROM "team_members" m WHERE m."id" = NEW."member_id";
  IF closing IS NOT NULL AND NEW."period" >= closing THEN
    IF NOT final THEN
      RAISE EXCEPTION 'statement % of a member who left is final from his closing fortnight on: compute it again (EQ-14, ADR 0039 § 6)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF "member_documents_open"(NEW."member_id") > 0 THEN
      RAISE EXCEPTION 'statement % waits until no document of its member awaits an answer or stays contested (ADR 0039 § 6)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF final THEN
    RAISE EXCEPTION 'statement % is final, but only a member who left has final statements, from his closing fortnight on (EQ-14)', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commission_statements_final_kept" BEFORE UPDATE ON "commission_statements"
  FOR EACH ROW WHEN (OLD."status" = 'draft' AND NEW."status" = 'validated')
  EXECUTE FUNCTION "keep_final_statement"();
