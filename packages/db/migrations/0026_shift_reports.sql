-- First, the key the reports' composite foreign key points to (moved up by hand: Drizzle writes it after it).
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_report_key_unique" UNIQUE("id","creator_id","platform_account_id","member_id");--> statement-breakpoint
CREATE TABLE "account_pay_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"from_period" date NOT NULL,
	"currency" text NOT NULL,
	"vat_bps" integer NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"earnings_source" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_pay_rules_account_period_unique" UNIQUE("platform_account_id","from_period"),
	CONSTRAINT "account_pay_rules_period_check" CHECK (extract(day from "account_pay_rules"."from_period") in (1, 16)),
	CONSTRAINT "account_pay_rules_bps_check" CHECK ("account_pay_rules"."vat_bps" between 0 and 10000 and "account_pay_rules"."platform_fee_bps" between 0 and 10000),
	CONSTRAINT "account_pay_rules_currency_check" CHECK ("account_pay_rules"."currency" in ('EUR', 'USD')),
	CONSTRAINT "account_pay_rules_earnings_source_check" CHECK ("account_pay_rules"."earnings_source" in ('declared', 'detected'))
);
--> statement-breakpoint
ALTER TABLE "account_pay_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shift_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"period" date NOT NULL,
	"corrects_id" uuid,
	"amount_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"comment" text,
	"incident" text,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"by_agency" boolean DEFAULT false NOT NULL,
	"submitted_by" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_reports_id_shift_unique" UNIQUE("id","shift_id"),
	CONSTRAINT "shift_reports_status_check" CHECK ("shift_reports"."status" in ('submitted', 'validated', 'rejected')),
	CONSTRAINT "shift_reports_currency_check" CHECK ("shift_reports"."currency" in ('EUR', 'USD')),
	CONSTRAINT "shift_reports_period_check" CHECK (extract(day from "shift_reports"."period") in (1, 16)),
	CONSTRAINT "shift_reports_amount_check" CHECK ("shift_reports"."amount_minor" between -5000000 and 5000000 and case when "shift_reports"."corrects_id" is null then "shift_reports"."amount_minor" >= 0 else "shift_reports"."amount_minor" <> 0 end),
	CONSTRAINT "shift_reports_correction_check" CHECK ("shift_reports"."corrects_id" is not null or ("shift_reports"."by_agency" = false)),
	CONSTRAINT "shift_reports_incident_check" CHECK ("shift_reports"."corrects_id" is null or "shift_reports"."incident" is null),
	CONSTRAINT "shift_reports_texts_check" CHECK (coalesce(char_length("shift_reports"."comment"), 1) between 1 and 1000 and coalesce(char_length("shift_reports"."incident"), 1) between 1 and 1000 and coalesce(char_length("shift_reports"."review_note"), 1) between 1 and 500),
	CONSTRAINT "shift_reports_version_check" CHECK ("shift_reports"."version" >= 1),
	CONSTRAINT "shift_reports_state_check" CHECK (("shift_reports"."reviewed_at" is null) = ("shift_reports"."reviewed_by" is null) and ("shift_reports"."status" = 'submitted') = ("shift_reports"."reviewed_at" is null) and ("shift_reports"."status" = 'rejected') = ("shift_reports"."review_note" is not null))
);
--> statement-breakpoint
ALTER TABLE "shift_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_pay_rules" ADD CONSTRAINT "account_pay_rules_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_pay_rules" ADD CONSTRAINT "account_pay_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_pay_rules" ADD CONSTRAINT "account_pay_rules_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_shift_fk" FOREIGN KEY ("shift_id","creator_id","platform_account_id","member_id") REFERENCES "public"."shifts"("id","creator_id","platform_account_id","member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_reports" ADD CONSTRAINT "shift_reports_corrects_fk" FOREIGN KEY ("corrects_id","shift_id") REFERENCES "public"."shift_reports"("id","shift_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_reports_shift_unique" ON "shift_reports" USING btree ("shift_id") WHERE "shift_reports"."corrects_id" is null;--> statement-breakpoint
CREATE INDEX "shift_reports_creator_period_idx" ON "shift_reports" USING btree ("creator_id","period");--> statement-breakpoint
CREATE INDEX "shift_reports_member_period_idx" ON "shift_reports" USING btree ("member_id","period");--> statement-breakpoint
CREATE INDEX "shift_reports_open_idx" ON "shift_reports" USING btree ("creator_id","submitted_at") WHERE "shift_reports"."status" in ('submitted', 'rejected');--> statement-breakpoint
CREATE POLICY "team_read" ON "account_pay_rules" AS PERMISSIVE FOR SELECT TO public USING ("account_pay_rules"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from shifts s join team_members m on m.id = s.member_id where s.platform_account_id = "account_pay_rules"."platform_account_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "account_pay_rules" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("account_pay_rules"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "account_pay_rules"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "shift_reports" AS PERMISSIVE FOR SELECT TO public USING ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "shift_reports"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "member_insert" ON "shift_reports" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from team_members m where m.id = "shift_reports"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and not "shift_reports"."by_agency" and "shift_reports"."status" = 'submitted' and "shift_reports"."version" = 1 and "shift_reports"."created_by" = nullif(current_setting('app.user_id', true), '') and "shift_reports"."submitted_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "shift_reports" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shift_reports"."by_agency" and "shift_reports"."corrects_id" is not null and "shift_reports"."status" = 'submitted' and "shift_reports"."version" = 1 and "shift_reports"."created_by" = nullif(current_setting('app.user_id', true), '') and "shift_reports"."submitted_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "maker_update" ON "shift_reports" AS PERMISSIVE FOR UPDATE TO public USING ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "shift_reports"."status" in ('submitted', 'rejected') and ((not "shift_reports"."by_agency" and exists (select 1 from team_members m where m.id = "shift_reports"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))) or ("shift_reports"."by_agency" and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')))) WITH CHECK ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "shift_reports"."status" = 'submitted' and "shift_reports"."submitted_by" = nullif(current_setting('app.user_id', true), '') and ((not "shift_reports"."by_agency" and exists (select 1 from team_members m where m.id = "shift_reports"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))) or ("shift_reports"."by_agency" and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'))));--> statement-breakpoint
CREATE POLICY "team_review" ON "shift_reports" AS PERMISSIVE FOR UPDATE TO public USING ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shift_reports"."status" = 'submitted') WITH CHECK ("shift_reports"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shift_reports"."status" in ('validated', 'rejected') and "shift_reports"."reviewed_by" = nullif(current_setting('app.user_id', true), '') and not exists (select 1 from team_members m where m.id = "shift_reports"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and (nullif(current_setting('app.team_scope', true), '') = 'owner' or "shift_reports"."submitted_by" <> nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
-- Written by hand (EQ-03). Drizzle does not write what follows.
ALTER TABLE "account_pay_rules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Pay keeps its past: held for every role, as the planning's triggers of 0021.
CREATE FUNCTION "refuse_pay_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'this change to % is refused: pay keeps its past (EQ-03)', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
-- An account's pay rules are added only: a mistake is put right by the next rules.
CREATE TRIGGER "account_pay_rules_append_only" BEFORE UPDATE OR DELETE ON "account_pay_rules"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- A report keeps its shift, its period, its currency, its maker and what it corrects. Each change takes the next
-- version, so a review names what it read. It moves only submitted to submitted (changed), validated or rejected,
-- and rejected to submitted (sent again): a validated report never changes, and a review never touches the amount,
-- the texts or who sent it. Nothing is deleted.
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
        AND (NEW."amount_minor", NEW."comment", NEW."incident", NEW."submitted_by", NEW."submitted_at")
            IS DISTINCT FROM
            (OLD."amount_minor", OLD."comment", OLD."incident", OLD."submitted_by", OLD."submitted_at"))
  )
  EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "shift_reports_not_deleted" BEFORE DELETE ON "shift_reports" FOR EACH ROW
  EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- A shift that has its report is no longer cancelled: the report would name a shift that never happened. Read under
-- the policies of whoever cancels, the owner or an active manager, who read every report of the creator.
-- Complete only while `team_update` is the one policy on "shifts" that sets "cancelled_at" (`swap_update` keeps it
-- null): a policy that lets anyone else set it, a member say, makes this read see that member's reports alone.
CREATE FUNCTION "refuse_reported_shift_cancel"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "shift_reports" WHERE "shift_id" = NEW."id") THEN
    RAISE EXCEPTION 'shift % has its report: it is no longer cancelled (EQ-03)', NEW."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "shifts_reported_kept" BEFORE UPDATE ON "shifts" FOR EACH ROW
  WHEN (OLD."cancelled_at" IS NULL AND NEW."cancelled_at" IS NOT NULL)
  EXECUTE FUNCTION "refuse_reported_shift_cancel"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the triggers).
REVOKE ALL ON "account_pay_rules", "shift_reports" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "account_pay_rules", "shift_reports" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("amount_minor", "comment", "incident", "status", "version", "submitted_by", "submitted_at",
  "reviewed_by", "reviewed_at", "review_note", "updated_at") ON "shift_reports" TO nirvana_app;
