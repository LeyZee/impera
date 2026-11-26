CREATE TABLE "pay_sale_claim_answers" (
	"claim_id" uuid PRIMARY KEY NOT NULL,
	"outcome" text NOT NULL,
	"note" text,
	"answered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_sale_claim_answers_outcome_check" CHECK ("pay_sale_claim_answers"."outcome" in ('settled', 'not_retained', 'withdrawn')),
	CONSTRAINT "pay_sale_claim_answers_note_check" CHECK (("pay_sale_claim_answers"."note" is null or char_length("pay_sale_claim_answers"."note") between 1 and 500) and ("pay_sale_claim_answers"."outcome" <> 'not_retained' or "pay_sale_claim_answers"."note" is not null))
);
--> statement-breakpoint
ALTER TABLE "pay_sale_claim_answers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_sale_claims" (
	"id" uuid PRIMARY KEY NOT NULL,
	"member_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"period" date NOT NULL,
	"shift_starts_at" timestamp with time zone NOT NULL,
	"shift_ends_at" timestamp with time zone NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"creator_name" text NOT NULL,
	"note" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_sale_claims_shift_unique" UNIQUE("shift_id"),
	CONSTRAINT "pay_sale_claims_period_check" CHECK (extract(day from "pay_sale_claims"."period") in (1, 16)),
	CONSTRAINT "pay_sale_claims_platform_check" CHECK ("pay_sale_claims"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "pay_sale_claims_hours_check" CHECK ("pay_sale_claims"."shift_starts_at" < "pay_sale_claims"."shift_ends_at"),
	CONSTRAINT "pay_sale_claims_names_check" CHECK (char_length("pay_sale_claims"."handle") between 1 and 200 and char_length("pay_sale_claims"."creator_name") between 1 and 200),
	CONSTRAINT "pay_sale_claims_note_check" CHECK (char_length("pay_sale_claims"."note") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "pay_sale_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_sale_claim_answers" ADD CONSTRAINT "pay_sale_claim_answers_claim_id_pay_sale_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."pay_sale_claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_claim_answers" ADD CONSTRAINT "pay_sale_claim_answers_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_claims" ADD CONSTRAINT "pay_sale_claims_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_claims" ADD CONSTRAINT "pay_sale_claims_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_claims" ADD CONSTRAINT "pay_sale_claims_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_claims" ADD CONSTRAINT "pay_sale_claims_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_claims" ADD CONSTRAINT "pay_sale_claims_shift_fk" FOREIGN KEY ("shift_id","creator_id","platform_account_id","member_id") REFERENCES "public"."shifts"("id","creator_id","platform_account_id","member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_sale_claims_member_idx" ON "pay_sale_claims" USING btree ("member_id","created_at");--> statement-breakpoint
CREATE POLICY "member_read" ON "pay_sale_claim_answers" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from pay_sale_claims c where c.id = "pay_sale_claim_answers"."claim_id" and exists (select 1 from team_members m where m.id = c.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "member_insert" ON "pay_sale_claim_answers" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("pay_sale_claim_answers"."answered_by" = nullif(current_setting('app.user_id', true), '') and exists (select 1 from pay_sale_claims c where c.id = "pay_sale_claim_answers"."claim_id" and case when "pay_sale_claim_answers"."outcome" = 'withdrawn' then exists (select 1 from team_members m where m.id = c.member_id and m.user_id = nullif(current_setting('app.user_id', true), '')) else nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and not exists (select 1 from team_members m where m.id = c.member_id and m.user_id = nullif(current_setting('app.user_id', true), '')) end));--> statement-breakpoint
CREATE POLICY "member_read" ON "pay_sale_claims" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "pay_sale_claims"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_insert" ON "pay_sale_claims" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (select 1 from team_members m where m.id = "pay_sale_claims"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "pay_sale_claims"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
-- Written by hand (ADR 0101 § 18, trou 15). Drizzle does not write what follows.
ALTER TABLE "pay_sale_claims" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_sale_claim_answers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Added only, for every role (`refuse_pay_change` of 0026): a claim and its answer are both kept.
CREATE TRIGGER "pay_sale_claims_append_only" BEFORE UPDATE OR DELETE ON "pay_sale_claims"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "pay_sale_claim_answers_append_only" BEFORE UPDATE OR DELETE ON "pay_sale_claim_answers"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave: a member writes his own claim, an answer is added.
REVOKE ALL ON "pay_sale_claims" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "pay_sale_claim_answers" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "pay_sale_claims" FROM impera_service;--> statement-breakpoint
REVOKE ALL ON "pay_sale_claim_answers" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "pay_sale_claims" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pay_sale_claim_answers" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "pay_sale_claims" TO impera_service;--> statement-breakpoint
GRANT SELECT ON "pay_sale_claim_answers" TO impera_service;
