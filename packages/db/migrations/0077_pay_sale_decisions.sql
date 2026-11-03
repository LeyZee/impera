-- What a closing leaves held, and the validator's decisions on sales (CRM-03 lot b3, ADR 0050 § 5, ADR 0032). Two
-- tables, added only: no row before this migration changes.
CREATE TABLE "pay_period_held_sales" (
	"platform" text NOT NULL,
	"platform_sale_id" text NOT NULL,
	"event" text NOT NULL,
	"period" date NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_period_held_sales_pkey" PRIMARY KEY("platform","platform_sale_id","event"),
	CONSTRAINT "pay_period_held_sales_platform_check" CHECK ("pay_period_held_sales"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "pay_period_held_sales_event_check" CHECK ("pay_period_held_sales"."event" in ('sale', 'refund')),
	CONSTRAINT "pay_period_held_sales_reason_check" CHECK ("pay_period_held_sales"."reason" in ('chatter_unlinked', 'off_shift', 'status_unknown', 'refund_before_register', 'refund_before_base'))
);
--> statement-breakpoint
ALTER TABLE "pay_period_held_sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pay_sale_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"platform_sale_id" text NOT NULL,
	"revision" integer NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason" text,
	"author_member_id" uuid,
	"link_version" text,
	"note" text,
	"decided_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_sale_decisions_revision_unique" UNIQUE("platform","platform_sale_id","revision"),
	CONSTRAINT "pay_sale_decisions_platform_check" CHECK ("pay_sale_decisions"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "pay_sale_decisions_outcome_check" CHECK ("pay_sale_decisions"."outcome" in ('count', 'exclude', 'withdraw')),
	CONSTRAINT "pay_sale_decisions_reason_check" CHECK ("pay_sale_decisions"."reason" is null or "pay_sale_decisions"."reason" in ('chatter_unlinked', 'off_shift', 'status_unknown', 'refund_before_register', 'refund_before_base')),
	CONSTRAINT "pay_sale_decisions_revision_check" CHECK ("pay_sale_decisions"."revision" >= 1),
	CONSTRAINT "pay_sale_decisions_note_check" CHECK ("pay_sale_decisions"."note" is null or char_length("pay_sale_decisions"."note") between 1 and 500),
	CONSTRAINT "pay_sale_decisions_count_check" CHECK ("pay_sale_decisions"."outcome" <> 'count' or ("pay_sale_decisions"."author_member_id" is not null and "pay_sale_decisions"."link_version" is not null and "pay_sale_decisions"."reason" in ('off_shift', 'status_unknown'))),
	CONSTRAINT "pay_sale_decisions_link_check" CHECK (("pay_sale_decisions"."author_member_id" is null) = ("pay_sale_decisions"."link_version" is null))
);
--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_period_held_sales" ADD CONSTRAINT "pay_period_held_sales_period_pay_period_closings_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_period_closings"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_held_sales" ADD CONSTRAINT "pay_period_held_sales_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_author_member_id_team_members_id_fk" FOREIGN KEY ("author_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "agency_read" ON "pay_period_held_sales" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "pay_period_held_sales" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "member_read" ON "pay_sale_decisions" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or ("pay_sale_decisions"."author_member_id" is not null and exists (select 1 from team_members m where m.id = "pay_sale_decisions"."author_member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "pay_sale_decisions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "pay_sale_decisions"."decided_by" = nullif(current_setting('app.user_id', true), '') and ("pay_sale_decisions"."author_member_id" is null or not exists (select 1 from team_members m where m.id = "pay_sale_decisions"."author_member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));
--> statement-breakpoint
-- Written by hand (CRM-03 lot b3). Drizzle does not write what follows.
ALTER TABLE "pay_period_held_sales" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Added only, for every role (`refuse_pay_change` of 0026): what a closing left and what was decided never change.
CREATE TRIGGER "pay_period_held_sales_append_only" BEFORE UPDATE OR DELETE ON "pay_period_held_sales"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
CREATE TRIGGER "pay_sale_decisions_append_only" BEFORE UPDATE OR DELETE ON "pay_sale_decisions"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- A held sale is left by the closing written in this very transaction (as a counted sale in 0074), and is a line of
-- the platform's register on its account. Read under the policies of whoever writes: the line's creator is entered.
CREATE FUNCTION "keep_held_sale"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pay_period_closings" c
    WHERE c."period" = NEW."period" AND c."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'a held sale is left by the closing of its own transaction (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "platform_sales" l
    WHERE l."platform" = NEW."platform" AND l."platform_sale_id" = NEW."platform_sale_id" AND l."event" = NEW."event"
      AND l."platform_account_id" = NEW."platform_account_id"
  ) THEN
    RAISE EXCEPTION 'a held sale is a line of the register, on its account (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_period_held_sales_left" BEFORE INSERT ON "pay_period_held_sales"
  FOR EACH ROW EXECUTE FUNCTION "keep_held_sale"();--> statement-breakpoint
-- A decision is numbered per sale from 1 without a gap, on a sale of the register on its account (a refund's line
-- alone when its sale is older than the register), and never on a sale a closing counted: a closed period keeps what it
-- paid, a correction goes through an adjustment (ADR 0032, ADR 0039). A withdrawal takes back a decision: never the
-- first, never after another one. Read under the writer's policies, the line's creator entered.
CREATE FUNCTION "keep_sale_decision"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" <> coalesce((
    SELECT max(d."revision") FROM "pay_sale_decisions" d
    WHERE d."platform" = NEW."platform" AND d."platform_sale_id" = NEW."platform_sale_id"
  ), 0) + 1 THEN
    RAISE EXCEPTION 'a decision takes the next number of its sale (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."outcome" = 'withdraw' AND coalesce((
    SELECT d."outcome" FROM "pay_sale_decisions" d
    WHERE d."platform" = NEW."platform" AND d."platform_sale_id" = NEW."platform_sale_id"
    ORDER BY d."revision" DESC LIMIT 1
  ), 'withdraw') = 'withdraw' THEN
    RAISE EXCEPTION 'a withdrawal takes back a decision (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "platform_sales" l
    WHERE l."platform" = NEW."platform" AND l."platform_sale_id" = NEW."platform_sale_id"
      AND l."platform_account_id" = NEW."platform_account_id"
  ) THEN
    RAISE EXCEPTION 'a decision is on a sale of the register, on its account (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "pay_period_sales" r
    WHERE r."platform" = NEW."platform" AND r."platform_sale_id" = NEW."platform_sale_id"
  ) THEN
    RAISE EXCEPTION 'a sale a closing counted is never decided again: pay keeps its past (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_sale_decisions_kept" BEFORE INSERT ON "pay_sale_decisions"
  FOR EACH ROW EXECUTE FUNCTION "keep_sale_decision"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave. A validation writes the first, a validator the second.
REVOKE ALL ON "pay_period_held_sales" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pay_period_held_sales" TO nirvana_app;--> statement-breakpoint
REVOKE ALL ON "pay_sale_decisions" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pay_sale_decisions" TO nirvana_app;
