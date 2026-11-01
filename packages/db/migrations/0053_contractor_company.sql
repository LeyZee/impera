-- EQ-06, the accountant's answers of 01/11/2026 (art. R123-237 of the Code de commerce): a contractor that is a
-- French company prints on its invoices its legal form, its share capital and the town of its trade register, after
-- its SIREN. The three go together, never for an individual entrepreneur (who prints « EI », lot 4). The code refuses
-- an invoice to a French contractor who is neither (`identity_incomplete`); the base keeps the three together, counts
-- them in the identity whose change withdraws the owner's check, and lets the application write them.
ALTER TABLE "contractor_profiles" ADD COLUMN "legal_form" text;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD COLUMN "share_capital_minor" bigint;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD COLUMN "rcs_city" text;--> statement-breakpoint
ALTER TABLE "contractor_profiles" ADD CONSTRAINT "contractor_profiles_company_check" CHECK (("contractor_profiles"."legal_form" is null) = ("contractor_profiles"."share_capital_minor" is null) and ("contractor_profiles"."legal_form" is null) = ("contractor_profiles"."rcs_city" is null) and ("contractor_profiles"."legal_form" is null or (not "contractor_profiles"."individual_entrepreneur" and char_length("contractor_profiles"."legal_form") between 1 and 40 and "contractor_profiles"."share_capital_minor" >= 1 and char_length("contractor_profiles"."rcs_city") between 1 and 60)));--> statement-breakpoint
-- 0045's function, with the three parts of a company's identity in the change that withdraws the check.
CREATE OR REPLACE FUNCTION "keep_contractor_profile"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  scope CONSTANT text := nullif(current_setting('app.team_scope', true), '');
  actor CONSTANT text := nullif(current_setting('app.user_id', true), '');
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."verified_at" IS NOT NULL THEN
      RAISE EXCEPTION 'a contractor''s file is checked after it is written (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."invoice_prefix" IS NOT NULL AND scope IS NOT NULL AND scope <> 'owner' THEN
      RAISE EXCEPTION 'only the owner sets a contractor''s prefix (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF (NEW."member_id", NEW."created_at") IS DISTINCT FROM (OLD."member_id", OLD."created_at") THEN
    RAISE EXCEPTION 'file % keeps its contractor (EQ-06)', OLD."member_id" USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."invoice_prefix" IS DISTINCT FROM OLD."invoice_prefix" THEN
    IF scope IS NOT NULL AND scope <> 'owner' THEN
      RAISE EXCEPTION 'only the owner sets a contractor''s prefix (EQ-06)' USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "invoices" i WHERE i."member_id" = OLD."member_id") THEN
      RAISE EXCEPTION 'the prefix of % is frozen by their first invoice (EQ-06)', OLD."member_id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  IF (NEW."legal_name", NEW."address", NEW."tax_id", NEW."business_id", NEW."vat_number",
      NEW."individual_entrepreneur", NEW."legal_form", NEW."share_capital_minor", NEW."rcs_city", NEW."email")
     IS DISTINCT FROM
     (OLD."legal_name", OLD."address", OLD."tax_id", OLD."business_id", OLD."vat_number",
      OLD."individual_entrepreneur", OLD."legal_form", OLD."share_capital_minor", OLD."rcs_city", OLD."email") THEN
    NEW."verified_at" := NULL;
    NEW."verified_by" := NULL;
  ELSIF NEW."verified_at" IS NOT NULL
        AND (NEW."verified_at", NEW."verified_by") IS DISTINCT FROM (OLD."verified_at", OLD."verified_by") THEN
    IF scope IS NOT NULL AND (scope <> 'owner' OR NEW."verified_by" IS DISTINCT FROM actor) THEN
      RAISE EXCEPTION 'only the owner checks a contractor''s file, in their own name (EQ-06)'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF NEW."verified_at" IS NULL AND OLD."verified_at" IS NOT NULL AND scope IS NOT NULL AND scope <> 'owner' THEN
    RAISE EXCEPTION 'only the owner withdraws their check (EQ-06)' USING ERRCODE = 'restrict_violation';
  END IF;
  NEW."updated_at" := now();
  RETURN NEW;
END;
$$;--> statement-breakpoint
GRANT UPDATE ("legal_form", "share_capital_minor", "rcs_city") ON "contractor_profiles" TO nirvana_app;
