ALTER TABLE "pay_sale_decisions" DROP CONSTRAINT "pay_sale_decisions_outcome_check";--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" DROP CONSTRAINT "pay_sale_decisions_link_check";--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD COLUMN "share_bp" smallint DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD COLUMN "share_role" text;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD COLUMN "recipient_member_id" uuid;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD COLUMN "share_bp" smallint;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD COLUMN "exclude_reason" text;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD COLUMN "sale_currency" text;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD COLUMN "sale_net_minor" integer;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD COLUMN "sale_occurred_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_recipient_member_id_team_members_id_fk" FOREIGN KEY ("recipient_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_period_sales" DROP CONSTRAINT "pay_period_sales_pkey";
--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD CONSTRAINT "pay_period_sales_pkey" PRIMARY KEY("platform","platform_sale_id","event","member_id");--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD CONSTRAINT "pay_period_sales_share_role_check" CHECK ("pay_period_sales"."share_role" in ('author', 'recipient'));--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD CONSTRAINT "pay_period_sales_share_check" CHECK (("pay_period_sales"."share_role" is null and "pay_period_sales"."share_bp" = 10000) or ("pay_period_sales"."share_role" is not null and "pay_period_sales"."share_bp" between 1 and 9999));--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_exclude_reason_check" CHECK ("pay_sale_decisions"."exclude_reason" in ('agent_decisive', 'other'));--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_sale_currency_check" CHECK ("pay_sale_decisions"."sale_currency" in ('EUR', 'USD'));--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_give_check" CHECK (("pay_sale_decisions"."outcome" = 'give') = ("pay_sale_decisions"."recipient_member_id" is not null) and ("pay_sale_decisions"."outcome" = 'give') = ("pay_sale_decisions"."share_bp" is not null) and ("pay_sale_decisions"."outcome" <> 'give' or ("pay_sale_decisions"."note" is not null and "pay_sale_decisions"."link_version" is not null and "pay_sale_decisions"."sale_currency" is not null and "pay_sale_decisions"."sale_net_minor" >= 0 and "pay_sale_decisions"."sale_occurred_at" is not null and "pay_sale_decisions"."recipient_member_id" is distinct from "pay_sale_decisions"."author_member_id" and "pay_sale_decisions"."share_bp" between 1000 and 10000 and "pay_sale_decisions"."share_bp" % 1000 = 0 and ("pay_sale_decisions"."share_bp" = 10000 or "pay_sale_decisions"."author_member_id" is not null))));--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_sale_check" CHECK (("pay_sale_decisions"."outcome" = 'give') = ("pay_sale_decisions"."sale_currency" is not null) and ("pay_sale_decisions"."sale_currency" is null) = ("pay_sale_decisions"."sale_net_minor" is null) and ("pay_sale_decisions"."sale_currency" is null) = ("pay_sale_decisions"."sale_occurred_at" is null));--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_exclude_outcome_check" CHECK ("pay_sale_decisions"."exclude_reason" is null or "pay_sale_decisions"."outcome" = 'exclude');--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_outcome_check" CHECK ("pay_sale_decisions"."outcome" in ('count', 'exclude', 'give', 'withdraw'));--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_link_check" CHECK ("pay_sale_decisions"."author_member_id" is null or "pay_sale_decisions"."link_version" is not null);--> statement-breakpoint
ALTER POLICY "member_read" ON "pay_sale_decisions" TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or ("pay_sale_decisions"."author_member_id" is not null and exists (select 1 from team_members m where m.id = "pay_sale_decisions"."author_member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))) or ("pay_sale_decisions"."recipient_member_id" is not null and exists (select 1 from team_members m where m.id = "pay_sale_decisions"."recipient_member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
ALTER POLICY "agency_insert" ON "pay_sale_decisions" TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "pay_sale_decisions"."decided_by" = nullif(current_setting('app.user_id', true), '') and ("pay_sale_decisions"."author_member_id" is null or not exists (select 1 from team_members m where m.id = "pay_sale_decisions"."author_member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))) and ("pay_sale_decisions"."recipient_member_id" is null or not exists (select 1 from team_members m where m.id = "pay_sale_decisions"."recipient_member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- Written by hand (ADR 0101). Drizzle does not write what follows. No row before this migration changes: every
-- registry row is a whole line (`share_bp` 10000, no role), every decision keeps its outcome, its reason and its note.
--
-- A counted sale is the line of the register it names, with its account and currency; its net is the line's (a
-- refund's taken off, so negative), or, for a line the validator shared (ADR 0101 §§ 11–14), its part: the
-- recipient's share of the line's magnitude rounded once, half away from zero, and the rest to the author, both with
-- the line's sign. Read under the policies of whoever writes: the line's creator is the one entered.
CREATE OR REPLACE FUNCTION "keep_counted_sale"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_net bigint;
  given bigint;
  expected bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "pay_period_closings" c
    WHERE c."period" = NEW."period" AND c."xmin" = pg_current_xact_id()::xid
  ) THEN
    RAISE EXCEPTION 'a sale is counted by the closing of its own transaction (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT CASE WHEN l."event" = 'refund' THEN -l."net_minor" ELSE l."net_minor" END INTO line_net
    FROM "platform_sales" l
   WHERE l."platform" = NEW."platform" AND l."platform_sale_id" = NEW."platform_sale_id" AND l."event" = NEW."event"
     AND l."platform_account_id" = NEW."platform_account_id" AND l."currency" = NEW."currency";
  IF line_net IS NULL THEN
    RAISE EXCEPTION 'a counted sale is a line of the register, with its account, currency and net (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  -- The recipient's part: its own share, or what the author's share leaves.
  given := sign(line_net) * round(abs(line_net)::numeric * CASE WHEN NEW."share_role" = 'author'
    THEN 10000 - NEW."share_bp" ELSE NEW."share_bp" END / 10000);
  -- Computed apart: in plpgsql, an IF's condition ends at its first THEN.
  expected := CASE
    WHEN NEW."share_role" IS NULL THEN line_net
    WHEN NEW."share_role" = 'recipient' THEN given
    ELSE line_net - given
  END;
  IF NEW."net_minor" <> expected THEN
    RAISE EXCEPTION 'a counted sale is a line of the register, with its account, currency and net (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
-- A line is counted whole for one member, or shared between an author and a recipient whose shares make the whole:
-- checked at the commit of the closing, once every part of the line is written (ADR 0101 § 13).
CREATE FUNCTION "keep_counted_sale_parts"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rows_count int;
  shares int;
  authors int;
  recipients int;
BEGIN
  SELECT count(*), coalesce(sum(r."share_bp"), 0), count(*) FILTER (WHERE r."share_role" = 'author'),
         count(*) FILTER (WHERE r."share_role" = 'recipient')
    INTO rows_count, shares, authors, recipients
    FROM "pay_period_sales" r
   WHERE r."platform" = NEW."platform" AND r."platform_sale_id" = NEW."platform_sale_id" AND r."event" = NEW."event";
  IF shares <> 10000 OR NOT (rows_count = 1 OR (rows_count = 2 AND authors = 1 AND recipients = 1)) THEN
    RAISE EXCEPTION 'a counted line is whole for one member, or shared between its author and a recipient (ADR 0101)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER "pay_period_sales_parts" AFTER INSERT ON "pay_period_sales"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION "keep_counted_sale_parts"();--> statement-breakpoint
-- 0077's rules for a decision, and one more for a give: it keeps the sale's line of the register as it is (currency,
-- net, instant), so that its author reads it once it has left their statement. Read under the writer's policies, the
-- line's creator entered.
CREATE OR REPLACE FUNCTION "keep_sale_decision"() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW."outcome" = 'give' AND NOT EXISTS (
    SELECT 1 FROM "platform_sales" l
    WHERE l."platform" = NEW."platform" AND l."platform_sale_id" = NEW."platform_sale_id" AND l."event" = 'sale'
      AND l."platform_account_id" = NEW."platform_account_id" AND l."currency" = NEW."sale_currency"
      AND l."net_minor" = NEW."sale_net_minor" AND l."occurred_at" = NEW."sale_occurred_at"
  ) THEN
    RAISE EXCEPTION 'a give keeps its sale as the register has it (ADR 0101)'
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
$$;
