CREATE TABLE "bonus_tier_sets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"from_period" date NOT NULL,
	"tiers" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bonus_tier_sets_period_check" CHECK (extract(day from "bonus_tier_sets"."from_period") in (1, 16)),
	CONSTRAINT "bonus_tier_sets_tiers_check" CHECK (jsonb_typeof("bonus_tier_sets"."tiers") = 'array')
);
--> statement-breakpoint
ALTER TABLE "bonus_tier_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "bonuses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"period" date NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	CONSTRAINT "bonuses_period_check" CHECK (extract(day from "bonuses"."period") in (1, 16)),
	CONSTRAINT "bonuses_amount_check" CHECK ("bonuses"."amount_minor" between 1 and 5000000),
	CONSTRAINT "bonuses_reason_check" CHECK (char_length("bonuses"."reason") between 1 and 500),
	CONSTRAINT "bonuses_cancellation_check" CHECK (("bonuses"."cancelled_at" is null) = ("bonuses"."cancelled_by" is null))
);
--> statement-breakpoint
ALTER TABLE "bonuses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "carry_overs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"from_period" date NOT NULL,
	"to_period" date NOT NULL,
	"amount_minor" integer NOT NULL,
	"statement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "carry_overs_statement_id_unique" UNIQUE("statement_id"),
	CONSTRAINT "carry_overs_member_period_unique" UNIQUE("member_id","from_period"),
	CONSTRAINT "carry_overs_from_period_check" CHECK (extract(day from "carry_overs"."from_period") in (1, 16)),
	CONSTRAINT "carry_overs_to_period_check" CHECK (extract(day from "carry_overs"."to_period") in (1, 16)),
	CONSTRAINT "carry_overs_periods_check" CHECK ("carry_overs"."to_period" > "carry_overs"."from_period"),
	CONSTRAINT "carry_overs_amount_check" CHECK ("carry_overs"."amount_minor" <> 0)
);
--> statement-breakpoint
ALTER TABLE "carry_overs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "collective_goals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"period" date NOT NULL,
	"target_minor" bigint NOT NULL,
	"tiers" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collective_goals_period_check" CHECK (extract(day from "collective_goals"."period") in (1, 16)),
	CONSTRAINT "collective_goals_target_check" CHECK ("collective_goals"."target_minor" between 1 and 100000000),
	CONSTRAINT "collective_goals_tiers_check" CHECK (jsonb_typeof("collective_goals"."tiers") = 'array')
);
--> statement-breakpoint
ALTER TABLE "collective_goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commission_statement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"statement_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"vat_bps" integer NOT NULL,
	"platform_fee_bps" integer NOT NULL,
	"rate_micros" bigint NOT NULL,
	"gross_minor" integer NOT NULL,
	"gross_eur_minor" integer NOT NULL,
	"excl_vat_minor" integer NOT NULL,
	"net_minor" integer NOT NULL,
	"commission_minor" integer NOT NULL,
	"shift_report_ids" uuid[] NOT NULL,
	"late_reports" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statement_lines_rules_unique" UNIQUE("statement_id","revision","platform_account_id","currency","vat_bps","platform_fee_bps"),
	CONSTRAINT "commission_statement_lines_currency_check" CHECK ("commission_statement_lines"."currency" in ('EUR', 'USD')),
	CONSTRAINT "commission_statement_lines_rules_check" CHECK ("commission_statement_lines"."revision" >= 1 and "commission_statement_lines"."rate_micros" > 0 and "commission_statement_lines"."vat_bps" between 0 and 10000 and "commission_statement_lines"."platform_fee_bps" between 0 and 10000),
	CONSTRAINT "commission_statement_lines_late_check" CHECK (jsonb_typeof("commission_statement_lines"."late_reports") = 'array')
);
--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "commission_statements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"period" date NOT NULL,
	"status" text NOT NULL,
	"revision" integer NOT NULL,
	"engine_version" text NOT NULL,
	"inputs_hash" text NOT NULL,
	"net_minor" integer NOT NULL,
	"commission_minor" integer NOT NULL,
	"team_share_base_minor" bigint,
	"team_share_bps" integer,
	"team_share_minor" integer,
	"tier_bonus" jsonb,
	"collective_bonus_minor" integer NOT NULL,
	"bonuses_minor" integer NOT NULL,
	"penalties_requested_minor" integer NOT NULL,
	"penalties_minor" integer NOT NULL,
	"carry_overs_in_minor" integer NOT NULL,
	"adjustments_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"carry_over_out_minor" integer NOT NULL,
	"payable_minor" integer NOT NULL,
	"team_net_minor" bigint NOT NULL,
	"collective" jsonb,
	"rules" jsonb NOT NULL,
	"counted" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"validated_at" timestamp with time zone,
	"validated_by" text,
	"paid_at" timestamp with time zone,
	"paid_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_statements_member_period_unique" UNIQUE("member_id","period"),
	CONSTRAINT "commission_statements_status_check" CHECK ("commission_statements"."status" in ('draft', 'validated', 'paid')),
	CONSTRAINT "commission_statements_revision_check" CHECK ("commission_statements"."revision" >= 1),
	CONSTRAINT "commission_statements_engine_check" CHECK ("commission_statements"."engine_version" ~ '^nirvana-[0-9]+$'),
	CONSTRAINT "commission_statements_hash_check" CHECK ("commission_statements"."inputs_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "commission_statements_amounts_check" CHECK ("commission_statements"."payable_minor" >= 0 and "commission_statements"."payable_minor" = "commission_statements"."total_minor" - "commission_statements"."carry_over_out_minor" and "commission_statements"."penalties_minor" between 0 and greatest("commission_statements"."penalties_requested_minor", 0)),
	CONSTRAINT "commission_statements_team_share_check" CHECK (("commission_statements"."team_share_bps" is null) = ("commission_statements"."team_share_minor" is null) and ("commission_statements"."team_share_bps" is null) = ("commission_statements"."team_share_base_minor" is null) and ("commission_statements"."team_share_bps" is null or "commission_statements"."team_share_bps" between 0 and 10000)),
	CONSTRAINT "commission_statements_state_check" CHECK (("commission_statements"."validated_at" is null) = ("commission_statements"."validated_by" is null) and ("commission_statements"."paid_at" is null) = ("commission_statements"."paid_by" is null) and ("commission_statements"."status" = 'draft') = ("commission_statements"."validated_at" is null) and ("commission_statements"."status" = 'paid') = ("commission_statements"."paid_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "commission_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"currency" text NOT NULL,
	"day" date NOT NULL,
	"rate_micros" bigint NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	CONSTRAINT "exchange_rates_pkey" PRIMARY KEY("currency","day"),
	CONSTRAINT "exchange_rates_currency_check" CHECK ("exchange_rates"."currency" in ('USD')),
	CONSTRAINT "exchange_rates_rate_check" CHECK ("exchange_rates"."rate_micros" > 0),
	CONSTRAINT "exchange_rates_source_check" CHECK (char_length("exchange_rates"."source") between 1 and 100)
);
--> statement-breakpoint
ALTER TABLE "exchange_rates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"period" date NOT NULL,
	"amount_minor" integer NOT NULL,
	"reason" text NOT NULL,
	"corrects_statement_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_adjustments_period_check" CHECK (extract(day from "pay_adjustments"."period") in (1, 16)),
	CONSTRAINT "pay_adjustments_amount_check" CHECK ("pay_adjustments"."amount_minor" between -5000000 and 5000000 and "pay_adjustments"."amount_minor" <> 0),
	CONSTRAINT "pay_adjustments_reason_check" CHECK (char_length("pay_adjustments"."reason") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "pay_adjustments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_periods" (
	"period" date PRIMARY KEY NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"time_zone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_periods_period_check" CHECK (extract(day from "pay_periods"."period") in (1, 16)),
	CONSTRAINT "pay_periods_window_check" CHECK ("pay_periods"."ends_at" > "pay_periods"."starts_at")
);
--> statement-breakpoint
ALTER TABLE "pay_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payroll_settings" (
	"id" smallint PRIMARY KEY NOT NULL,
	"minimum_payout_minor" integer NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_settings_single_check" CHECK ("payroll_settings"."id" = 1),
	CONSTRAINT "payroll_settings_minimum_check" CHECK ("payroll_settings"."minimum_payout_minor" between 0 and 5000000)
);
--> statement-breakpoint
ALTER TABLE "payroll_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "penalties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"from_period" date NOT NULL,
	"to_period" date NOT NULL,
	"kind" text NOT NULL,
	"amount_minor" integer,
	"bps" integer,
	"reason" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	"cancelled_from" date,
	CONSTRAINT "penalties_from_period_check" CHECK (extract(day from "penalties"."from_period") in (1, 16)),
	CONSTRAINT "penalties_to_period_check" CHECK (extract(day from "penalties"."to_period") in (1, 16)),
	CONSTRAINT "penalties_periods_check" CHECK ("penalties"."to_period" >= "penalties"."from_period"),
	CONSTRAINT "penalties_kind_check" CHECK ("penalties"."kind" in ('fixed', 'percent')),
	CONSTRAINT "penalties_amount_check" CHECK (case when "penalties"."kind" = 'fixed' then "penalties"."amount_minor" between 1 and 5000000 and "penalties"."bps" is null else "penalties"."bps" between 1 and 10000 and "penalties"."amount_minor" is null end),
	CONSTRAINT "penalties_reason_check" CHECK (char_length("penalties"."reason") between 1 and 500),
	CONSTRAINT "penalties_cancellation_check" CHECK (("penalties"."cancelled_at" is null) = ("penalties"."cancelled_by" is null) and ("penalties"."cancelled_at" is null) = ("penalties"."cancelled_from" is null) and ("penalties"."cancelled_from" is null or (extract(day from "penalties"."cancelled_from") in (1, 16) and "penalties"."cancelled_from" between "penalties"."from_period" and "penalties"."to_period")))
);
--> statement-breakpoint
ALTER TABLE "penalties" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bonus_tier_sets" ADD CONSTRAINT "bonus_tier_sets_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bonuses" ADD CONSTRAINT "bonuses_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carry_overs" ADD CONSTRAINT "carry_overs_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carry_overs" ADD CONSTRAINT "carry_overs_statement_id_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collective_goals" ADD CONSTRAINT "collective_goals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_statement_id_commission_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" ADD CONSTRAINT "commission_statement_lines_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_period_pay_periods_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_periods"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_paid_by_user_id_fk" FOREIGN KEY ("paid_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_corrects_statement_id_commission_statements_id_fk" FOREIGN KEY ("corrects_statement_id") REFERENCES "public"."commission_statements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_adjustments" ADD CONSTRAINT "pay_adjustments_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "penalties" ADD CONSTRAINT "penalties_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bonus_tier_sets_period_idx" ON "bonus_tier_sets" USING btree ("from_period");--> statement-breakpoint
CREATE INDEX "bonuses_member_period_idx" ON "bonuses" USING btree ("member_id","period");--> statement-breakpoint
CREATE INDEX "carry_overs_member_to_idx" ON "carry_overs" USING btree ("member_id","to_period");--> statement-breakpoint
CREATE INDEX "collective_goals_period_idx" ON "collective_goals" USING btree ("period");--> statement-breakpoint
CREATE INDEX "commission_statements_period_idx" ON "commission_statements" USING btree ("period");--> statement-breakpoint
CREATE INDEX "pay_adjustments_member_period_idx" ON "pay_adjustments" USING btree ("member_id","period");--> statement-breakpoint
CREATE INDEX "penalties_member_period_idx" ON "penalties" USING btree ("member_id","from_period");--> statement-breakpoint
CREATE POLICY "team_read" ON "bonus_tier_sets" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "bonus_tier_sets" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "bonus_tier_sets"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "bonuses" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "bonuses"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "bonuses" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "bonuses"."created_by" = nullif(current_setting('app.user_id', true), '') and not exists (select 1 from team_members m where m.id = "bonuses"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "bonuses"."cancelled_at" is null);--> statement-breakpoint
CREATE POLICY "agency_cancel" ON "bonuses" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and not exists (select 1 from team_members m where m.id = "bonuses"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "bonuses"."cancelled_at" is null) WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "bonuses"."cancelled_by" = nullif(current_setting('app.user_id', true), '') and not exists (select 1 from team_members m where m.id = "bonuses"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_read" ON "carry_overs" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "carry_overs"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "carry_overs" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and not exists (select 1 from team_members m where m.id = "carry_overs"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "team_read" ON "collective_goals" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "collective_goals" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "collective_goals"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "commission_statement_lines" AS PERMISSIVE FOR SELECT TO public USING (exists (select 1 from commission_statements s where s.id = "commission_statement_lines"."statement_id" and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = s.member_id and m.user_id = nullif(current_setting('app.user_id', true), '')))));--> statement-breakpoint
CREATE POLICY "member_read" ON "commission_statements" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "commission_statements"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "agency_validate" ON "commission_statements" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "commission_statements"."status" = 'draft' and not exists (select 1 from team_members m where m.id = "commission_statements"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))) WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "commission_statements"."status" = 'validated' and "commission_statements"."validated_by" = nullif(current_setting('app.user_id', true), '') and not exists (select 1 from team_members m where m.id = "commission_statements"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_pay" ON "commission_statements" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' and "commission_statements"."status" = 'validated') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "commission_statements"."status" = 'paid' and "commission_statements"."paid_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "exchange_rates" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "member_read" ON "pay_adjustments" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "pay_adjustments"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "pay_adjustments" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "pay_adjustments"."created_by" = nullif(current_setting('app.user_id', true), '') and not exists (select 1 from team_members m where m.id = "pay_adjustments"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "team_read" ON "pay_periods" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "team_read" ON "payroll_settings" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
CREATE POLICY "owner_insert" ON "payroll_settings" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "payroll_settings"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "payroll_settings" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "payroll_settings"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "member_read" ON "penalties" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "penalties"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "penalties" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "penalties"."created_by" = nullif(current_setting('app.user_id', true), '') and not exists (select 1 from team_members m where m.id = "penalties"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "penalties"."cancelled_at" is null);--> statement-breakpoint
CREATE POLICY "agency_cancel" ON "penalties" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and not exists (select 1 from team_members m where m.id = "penalties"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "penalties"."cancelled_at" is null) WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "penalties"."cancelled_by" = nullif(current_setting('app.user_id', true), '') and not exists (select 1 from team_members m where m.id = "penalties"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
-- Written by hand (EQ-04). Drizzle does not write what follows.
ALTER TABLE "pay_periods" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exchange_rates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payroll_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bonus_tier_sets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "collective_goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bonuses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "penalties" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_statements" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "commission_statement_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_adjustments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "carry_overs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Added only, for every role (`refuse_pay_change` of 0026): a period's instants, the rates read, the tiers, the goals,
-- the lines of each revision, the adjustments and the carry-overs never change and are never deleted.
CREATE TRIGGER "pay_periods_append_only" BEFORE UPDATE OR DELETE ON "pay_periods"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "exchange_rates_append_only" BEFORE UPDATE OR DELETE ON "exchange_rates"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "bonus_tier_sets_append_only" BEFORE UPDATE OR DELETE ON "bonus_tier_sets"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "collective_goals_append_only" BEFORE UPDATE OR DELETE ON "collective_goals"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "commission_statement_lines_append_only" BEFORE UPDATE OR DELETE ON "commission_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "pay_adjustments_append_only" BEFORE UPDATE OR DELETE ON "pay_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "carry_overs_append_only" BEFORE UPDATE OR DELETE ON "carry_overs"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "bonuses_not_deleted" BEFORE DELETE ON "bonuses"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "penalties_not_deleted" BEFORE DELETE ON "penalties"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "commission_statements_not_deleted" BEFORE DELETE ON "commission_statements"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- A member's period is closed once a statement of that period or a later one is validated (periods close in order).
-- Read under the policies of whoever writes: the owner and an active manager read every statement, the only ones the
-- policies let write a bonus, a penalty, an adjustment, tiers or a goal; the jobs run as `nirvana_admin` (BYPASSRLS).
CREATE FUNCTION "pay_period_closed"(uuid, date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM "commission_statements" s WHERE s."member_id" = $1 AND s."period" >= $2 AND s."status" <> 'draft'
  )
$$;--> statement-breakpoint
-- Some member's statement of this period or a later one is validated: the team's rules of the period are settled.
CREATE FUNCTION "pay_period_settled"(date) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM "commission_statements" s WHERE s."period" >= $1 AND s."status" <> 'draft')
$$;--> statement-breakpoint
-- The period after `period`: the 16th after the 1st, the 1st of the next month after the 16th.
CREATE FUNCTION "next_pay_period"(date) RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN extract(day FROM $1) = 1 THEN $1 + 15 ELSE (date_trunc('month', $1) + interval '1 month')::date END
$$;--> statement-breakpoint
CREATE FUNCTION "refuse_closed_pay_input"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  closed boolean;
BEGIN
  -- One branch per table: PL/pgSQL resolves a field of NEW only in the branch it runs.
  IF TG_TABLE_NAME IN ('bonuses', 'pay_adjustments') THEN
    closed := "pay_period_closed"(NEW."member_id", NEW."period");
  ELSIF TG_TABLE_NAME = 'bonus_tier_sets' THEN
    closed := "pay_period_settled"(NEW."from_period");
  ELSE
    closed := "pay_period_settled"(NEW."period");
  END IF;
  IF closed THEN
    RAISE EXCEPTION 'this % is for a period already validated: pay keeps its past (EQ-04)', TG_TABLE_NAME
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "bonuses_open_period" BEFORE INSERT ON "bonuses"
  FOR EACH ROW EXECUTE FUNCTION "refuse_closed_pay_input"();--> statement-breakpoint
CREATE TRIGGER "pay_adjustments_open_period" BEFORE INSERT ON "pay_adjustments"
  FOR EACH ROW EXECUTE FUNCTION "refuse_closed_pay_input"();--> statement-breakpoint
CREATE TRIGGER "bonus_tier_sets_open_period" BEFORE INSERT ON "bonus_tier_sets"
  FOR EACH ROW EXECUTE FUNCTION "refuse_closed_pay_input"();--> statement-breakpoint
CREATE TRIGGER "collective_goals_open_period" BEFORE INSERT ON "collective_goals"
  FOR EACH ROW EXECUTE FUNCTION "refuse_closed_pay_input"();--> statement-breakpoint
-- A bonus changes only to be cancelled, once, while its period is open for the member.
CREATE FUNCTION "keep_bonus"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."cancelled_at" IS NOT NULL OR NEW."cancelled_at" IS NULL
     OR to_jsonb(NEW) - ARRAY['cancelled_at', 'cancelled_by'] IS DISTINCT FROM to_jsonb(OLD) - ARRAY['cancelled_at', 'cancelled_by']
     OR "pay_period_closed"(NEW."member_id", NEW."period") THEN
    RAISE EXCEPTION 'this change to bonus % is refused: pay keeps its past (EQ-04)', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "bonuses_kept" BEFORE UPDATE ON "bonuses"
  FOR EACH ROW EXECUTE FUNCTION "keep_bonus"();--> statement-breakpoint
-- A penalty starts in an open period, and changes only to be cancelled, once, from an open period on: the periods
-- already validated keep it.
CREATE FUNCTION "keep_penalty"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF "pay_period_closed"(NEW."member_id", NEW."from_period") THEN
      RAISE EXCEPTION 'this penalty starts in a period already validated: pay keeps its past (EQ-04)'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD."cancelled_at" IS NOT NULL OR NEW."cancelled_at" IS NULL
     OR to_jsonb(NEW) - ARRAY['cancelled_at', 'cancelled_by', 'cancelled_from']
        IS DISTINCT FROM to_jsonb(OLD) - ARRAY['cancelled_at', 'cancelled_by', 'cancelled_from']
     OR "pay_period_closed"(NEW."member_id", NEW."cancelled_from") THEN
    RAISE EXCEPTION 'this change to penalty % is refused: pay keeps its past (EQ-04)', OLD."id"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "penalties_kept" BEFORE INSERT OR UPDATE ON "penalties"
  FOR EACH ROW EXECUTE FUNCTION "keep_penalty"();--> statement-breakpoint
-- A statement is a draft until validated: a draft is made only for an open period, and each recalculation takes the
-- next revision, its member and period kept. Validating changes nothing but the status and who validated, once every
-- earlier statement of the member is validated. Paying changes nothing but the status and who paid. Nothing else,
-- for every role, and nothing is deleted.
CREATE FUNCTION "keep_commission_statement"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'draft' THEN
      RAISE EXCEPTION 'a statement is made a draft, and only a validation validates it (EQ-04)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF "pay_period_closed"(NEW."member_id", NEW."period") THEN
      RAISE EXCEPTION 'a draft for a period already validated: pay keeps its past (EQ-04)'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'draft' AND NEW."status" = 'draft' THEN
    IF (NEW."id", NEW."member_id", NEW."period", NEW."created_at") IS DISTINCT FROM
       (OLD."id", OLD."member_id", OLD."period", OLD."created_at")
       OR NEW."revision" <> OLD."revision" + 1 THEN
      RAISE EXCEPTION 'a recalculation keeps statement % and takes its next revision (EQ-04)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD."status" = 'draft' AND NEW."status" = 'validated' THEN
    IF to_jsonb(NEW) - ARRAY['status', 'validated_at', 'validated_by']
       IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'validated_at', 'validated_by'] THEN
      RAISE EXCEPTION 'validating statement % changes nothing else (EQ-04)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "commission_statements" s
      WHERE s."member_id" = NEW."member_id" AND s."period" < NEW."period" AND s."status" = 'draft'
    ) THEN
      RAISE EXCEPTION 'an earlier statement of the member is still a draft: periods close in order (EQ-04)'
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSIF OLD."status" = 'validated' AND NEW."status" = 'paid' THEN
    IF to_jsonb(NEW) - ARRAY['status', 'paid_at', 'paid_by']
       IS DISTINCT FROM to_jsonb(OLD) - ARRAY['status', 'paid_at', 'paid_by'] THEN
      RAISE EXCEPTION 'paying statement % changes nothing else (EQ-04)', OLD."id"
        USING ERRCODE = 'restrict_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'statement % is % and stays so: pay keeps its past (EQ-04)', OLD."id", OLD."status"
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commission_statements_kept" BEFORE INSERT OR UPDATE ON "commission_statements"
  FOR EACH ROW EXECUTE FUNCTION "keep_commission_statement"();--> statement-breakpoint
-- A line belongs to the current revision of a draft: a validated statement's lines are those of its last revision.
CREATE FUNCTION "keep_statement_line"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "commission_statements" s
    WHERE s."id" = NEW."statement_id" AND s."status" = 'draft' AND s."revision" = NEW."revision"
  ) THEN
    RAISE EXCEPTION 'a line names the current revision of a draft statement (EQ-04)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "commission_statement_lines_current" BEFORE INSERT ON "commission_statement_lines"
  FOR EACH ROW EXECUTE FUNCTION "keep_statement_line"();--> statement-breakpoint
-- A carry-over comes from its member's validated statement of `from_period`, to the period right after, and carries
-- exactly what that statement did not pay.
CREATE FUNCTION "keep_carry_over"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."to_period" <> "next_pay_period"(NEW."from_period") OR NOT EXISTS (
    SELECT 1 FROM "commission_statements" s
    WHERE s."id" = NEW."statement_id" AND s."member_id" = NEW."member_id" AND s."period" = NEW."from_period"
      AND s."status" = 'validated' AND s."carry_over_out_minor" = NEW."amount_minor"
  ) THEN
    RAISE EXCEPTION 'a carry-over is what its member''s validated statement carried, to the next period (EQ-04)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "carry_overs_from_statement" BEFORE INSERT ON "carry_overs"
  FOR EACH ROW EXECUTE FUNCTION "keep_carry_over"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the triggers).
-- Statements, their lines, the periods and the rates are written by the jobs (`nirvana_admin`); the application reads
-- them, validates, pays, and writes the inputs.
REVOKE ALL ON "pay_periods", "exchange_rates", "payroll_settings", "bonus_tier_sets", "collective_goals", "bonuses",
  "penalties", "commission_statements", "commission_statement_lines", "pay_adjustments", "carry_overs"
  FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "pay_periods", "exchange_rates", "commission_statement_lines" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "payroll_settings", "bonus_tier_sets", "collective_goals", "bonuses", "penalties",
  "pay_adjustments", "carry_overs" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("minimum_payout_minor", "updated_by", "updated_at") ON "payroll_settings" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("cancelled_at", "cancelled_by") ON "bonuses" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("cancelled_at", "cancelled_by", "cancelled_from") ON "penalties" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, UPDATE ("status", "validated_at", "validated_by", "paid_at", "paid_by") ON "commission_statements"
  TO nirvana_app;
