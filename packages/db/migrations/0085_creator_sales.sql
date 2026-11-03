-- A creator's own account and her sales (CRM-04 lot d, ADR 0042 § 2, ADR 0054). She reads her sales through the view
-- `creator_sales` alone: `platform_sales` closes to her (it names the chatter and the platform's fan), the outbox hides
-- from her (`sale_detected` names who sold) while her writes may still add to it, and the agency's tables of the sales
-- feed with a chatter, a fan or a team member in them turn RLS on with one permissive policy for every other path.
ALTER TABLE "platform_sales_quarantine" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_feed_chatters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_feed_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "creator_no_select" ON "domain_events" AS RESTRICTIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "platform_sales" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "agency_only" ON "platform_sales_quarantine" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "agency_only" ON "sales_feed_chatters" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "agency_only" ON "sales_feed_checks" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Her sales as her own account reads them: the lines of her register with their amounts, never the chatter nor the
-- platform's fan, and the fan's id in Nirvana only when his card is of her creator (Bilan, 03/11). The view belongs to
-- the migration role, which bypasses RLS, and is no `security_invoker`: its own filter is the one that holds, her
-- creator and her account's role as `withCreatorAccount` sets them, so any other transaction reads nothing from it.
-- The join on `f.creator_id` is what keeps another creator's card out, the owner bypassing the RLS of `fans`.
-- The view rests on `nirvana_admin BYPASSRLS`: `platform_sales` forces its RLS (0065), so an owner without it would
-- meet `creator_closed` and the view would go empty in silence (Bilan, review of #469).
CREATE VIEW "creator_sales" WITH (security_barrier = true) AS
SELECT l.id, l.creator_id, l.platform, l.platform_account_id, l.platform_sale_id, l.event, l.sale_type, l.occurred_at,
       l.currency, l.gross_incl_vat_minor, l.gross_excl_vat_minor, l.net_minor, l.agency_minor, l.creator_minor,
       f.id AS fan_id
  FROM platform_sales l
  LEFT JOIN fans f
    ON f.creator_id = l.creator_id
   AND f.platform_account_id = l.platform_account_id
   AND f.platform_fan_id = l.platform_fan_id
 WHERE l.creator_id = nullif(current_setting('app.creator_id', true), '')::uuid
   AND current_setting('app.account_role', true) = 'creator';--> statement-breakpoint
-- The application role reads the view, nothing else (the default privileges would grant it the writes too).
REVOKE ALL ON "creator_sales" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_sales" TO nirvana_app;
