-- Audit RLS du 06/11. Three tables of the sales feed had their policies without FORCE: every table with row-level
-- security forces it (data-model.md § RLS), so that a policy holds for its owner too.
ALTER TABLE "platform_sales_quarantine" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_feed_chatters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales_feed_checks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- A creator is archived, never deleted (ADR 0071), and `creators` is out of RLS: the application keeps no way to
-- delete one.
REVOKE DELETE ON "creators" FROM nirvana_app;
