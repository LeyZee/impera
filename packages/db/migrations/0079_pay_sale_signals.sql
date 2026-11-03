CREATE TABLE "pay_sale_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"platform_sale_id" text NOT NULL,
	"event" text NOT NULL,
	"member_id" uuid NOT NULL,
	"period" date NOT NULL,
	"revision" integer NOT NULL,
	"kind" text NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"currency" text NOT NULL,
	"net_minor" integer NOT NULL,
	"occurred_at" timestamp with time zone,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pay_sale_signals_revision_unique" UNIQUE("platform","platform_sale_id","event","member_id","period","revision"),
	CONSTRAINT "pay_sale_signals_platform_check" CHECK ("pay_sale_signals"."platform" in ('reveal', 'onlyfans', 'instagram', 'nirvana')),
	CONSTRAINT "pay_sale_signals_event_check" CHECK ("pay_sale_signals"."event" in ('sale', 'refund')),
	CONSTRAINT "pay_sale_signals_kind_check" CHECK ("pay_sale_signals"."kind" in ('signal', 'withdraw')),
	CONSTRAINT "pay_sale_signals_currency_check" CHECK ("pay_sale_signals"."currency" in ('EUR', 'USD')),
	CONSTRAINT "pay_sale_signals_period_check" CHECK (extract(day from "pay_sale_signals"."period") in (1, 16)),
	CONSTRAINT "pay_sale_signals_revision_check" CHECK ("pay_sale_signals"."revision" >= 1),
	CONSTRAINT "pay_sale_signals_note_check" CHECK ("pay_sale_signals"."note" is null or char_length("pay_sale_signals"."note") between 1 and 500),
	CONSTRAINT "pay_sale_signals_net_check" CHECK (("pay_sale_signals"."event" = 'sale' and "pay_sale_signals"."net_minor" >= 0) or ("pay_sale_signals"."event" = 'refund' and "pay_sale_signals"."net_minor" <= 0))
);
--> statement-breakpoint
ALTER TABLE "pay_sale_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_sale_signals" ADD CONSTRAINT "pay_sale_signals_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_signals" ADD CONSTRAINT "pay_sale_signals_period_pay_periods_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_periods"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_signals" ADD CONSTRAINT "pay_sale_signals_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pay_sale_signals" ADD CONSTRAINT "pay_sale_signals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pay_sale_signals_period_member_idx" ON "pay_sale_signals" USING btree ("period","member_id");--> statement-breakpoint
CREATE POLICY "member_read" ON "pay_sale_signals" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "pay_sale_signals"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "member_insert" ON "pay_sale_signals" AS PERMISSIVE FOR INSERT TO public WITH CHECK (exists (select 1 from team_members m where m.id = "pay_sale_signals"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "pay_sale_signals"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
-- Written by hand (CRM-03 lot b4c). Drizzle does not write what follows.
ALTER TABLE "pay_sale_signals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Added only, for every role (`refuse_pay_change` of 0026): a signal and its withdrawal are both kept.
CREATE TRIGGER "pay_sale_signals_append_only" BEFORE UPDATE OR DELETE ON "pay_sale_signals"
  FOR EACH ROW EXECUTE FUNCTION "refuse_pay_change"();--> statement-breakpoint
-- A signal is numbered per line, member and period from 1 without a gap. A withdrawal takes back a signal in force:
-- never the first, never after another one; a signal needs none in force. It goes on a period no closing closed, on a
-- line no closing counted, and on the member's own statement of that period as it stands: a line of the platform's net
-- on the account and in the currency kept, with the net and the instant kept. Read under the writer's policies, never
-- as a definer: a member reads their own statement and their own rows of the registry, and every closing.
CREATE FUNCTION "keep_sale_signal"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  latest text;
BEGIN
  IF NEW."revision" <> coalesce((
    SELECT max(s."revision") FROM "pay_sale_signals" s
    WHERE s."platform" = NEW."platform" AND s."platform_sale_id" = NEW."platform_sale_id"
      AND s."event" = NEW."event" AND s."member_id" = NEW."member_id" AND s."period" = NEW."period"
  ), 0) + 1 THEN
    RAISE EXCEPTION 'a signal takes the next number of its line (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT s."kind" INTO latest FROM "pay_sale_signals" s
   WHERE s."platform" = NEW."platform" AND s."platform_sale_id" = NEW."platform_sale_id"
     AND s."event" = NEW."event" AND s."member_id" = NEW."member_id" AND s."period" = NEW."period"
   ORDER BY s."revision" DESC LIMIT 1;
  IF NEW."kind" = 'withdraw' AND coalesce(latest, 'withdraw') = 'withdraw' THEN
    RAISE EXCEPTION 'a withdrawal takes back a signal (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."kind" = 'signal' AND latest = 'signal' THEN
    RAISE EXCEPTION 'a line is signalled once until its signal is withdrawn (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM "pay_period_closings" c WHERE c."period" = NEW."period") THEN
    RAISE EXCEPTION 'a closed period keeps what it paid: nothing is signalled on it (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "pay_period_sales" r
    WHERE r."platform" = NEW."platform" AND r."platform_sale_id" = NEW."platform_sale_id"
      AND r."event" = NEW."event"
  ) THEN
    RAISE EXCEPTION 'a line a closing counted is never signalled: pay keeps its past (ADR 0032)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "commission_statements" st
      JOIN "commission_statement_lines" l ON l."statement_id" = st."id" AND l."revision" = st."revision"
      CROSS JOIN LATERAL jsonb_array_elements(l."sales") e
     WHERE st."member_id" = NEW."member_id" AND st."period" = NEW."period" AND st."status" = 'draft'
       AND l."base" = 'platform_net' AND l."platform_account_id" = NEW."platform_account_id"
       AND l."currency" = NEW."currency"
       AND e->>'platform' = NEW."platform" AND e->>'platformSaleId' = NEW."platform_sale_id"
       AND e->>'event' = NEW."event" AND (e->>'netMinor')::bigint = NEW."net_minor"
       AND (e->>'occurredAt')::timestamptz IS NOT DISTINCT FROM NEW."occurred_at"
  ) THEN
    RAISE EXCEPTION 'a signal is on a line of the member''s own statement, as it stands (CRM-03)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "pay_sale_signals_kept" BEFORE INSERT ON "pay_sale_signals"
  FOR EACH ROW EXECUTE FUNCTION "keep_sale_signal"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave. A member writes their own.
REVOKE ALL ON "pay_sale_signals" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "pay_sale_signals" TO nirvana_app;
