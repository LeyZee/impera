ALTER TABLE "pay_period_held_sales" DROP CONSTRAINT "pay_period_held_sales_platform_check";--> statement-breakpoint
ALTER TABLE "pay_period_sales" DROP CONSTRAINT "pay_period_sales_platform_check";--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" DROP CONSTRAINT "pay_sale_decisions_platform_check";--> statement-breakpoint
ALTER TABLE "pay_sale_signals" DROP CONSTRAINT "pay_sale_signals_platform_check";--> statement-breakpoint
ALTER TABLE "platform_sales" DROP CONSTRAINT "platform_sales_platform_check";--> statement-breakpoint
ALTER TABLE "platform_sales_quarantine" DROP CONSTRAINT "platform_sales_quarantine_platform_check";--> statement-breakpoint
ALTER TABLE "sales_feed_chatters" DROP CONSTRAINT "sales_feed_chatters_platform_check";--> statement-breakpoint
ALTER TABLE "sales_feed_checks" DROP CONSTRAINT "sales_feed_checks_platform_check";--> statement-breakpoint
ALTER TABLE "sales_feed_credentials" DROP CONSTRAINT "sales_feed_credentials_platform_check";--> statement-breakpoint
ALTER TABLE "sales_feed_cursors" DROP CONSTRAINT "sales_feed_cursors_platform_check";--> statement-breakpoint
ALTER TABLE "sales_feed_deliveries" DROP CONSTRAINT "sales_feed_deliveries_platform_check";--> statement-breakpoint
ALTER TABLE "sales_feed_models" DROP CONSTRAINT "sales_feed_models_platform_check";--> statement-breakpoint
ALTER TABLE "sales_feed_webhooks" DROP CONSTRAINT "sales_feed_webhooks_platform_check";--> statement-breakpoint
ALTER TABLE "platform_accounts" DROP CONSTRAINT "platform_accounts_platform_check";--> statement-breakpoint
-- ADR 0062: our own platform is called impera. No row holds nirvana today; the update is a safety net.
UPDATE "pay_period_held_sales" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "pay_period_sales" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "pay_sale_decisions" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "pay_sale_signals" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "platform_sales" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "platform_sales_quarantine" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "sales_feed_chatters" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "sales_feed_checks" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "sales_feed_credentials" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "sales_feed_cursors" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "sales_feed_deliveries" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "sales_feed_models" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "sales_feed_webhooks" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
UPDATE "platform_accounts" SET "platform" = 'impera' WHERE "platform" = 'nirvana';--> statement-breakpoint
ALTER TABLE "pay_period_held_sales" ADD CONSTRAINT "pay_period_held_sales_platform_check" CHECK ("pay_period_held_sales"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "pay_period_sales" ADD CONSTRAINT "pay_period_sales_platform_check" CHECK ("pay_period_sales"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "pay_sale_decisions" ADD CONSTRAINT "pay_sale_decisions_platform_check" CHECK ("pay_sale_decisions"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "pay_sale_signals" ADD CONSTRAINT "pay_sale_signals_platform_check" CHECK ("pay_sale_signals"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "platform_sales" ADD CONSTRAINT "platform_sales_platform_check" CHECK ("platform_sales"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "platform_sales_quarantine" ADD CONSTRAINT "platform_sales_quarantine_platform_check" CHECK ("platform_sales_quarantine"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "sales_feed_chatters" ADD CONSTRAINT "sales_feed_chatters_platform_check" CHECK ("sales_feed_chatters"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "sales_feed_checks" ADD CONSTRAINT "sales_feed_checks_platform_check" CHECK ("sales_feed_checks"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "sales_feed_credentials" ADD CONSTRAINT "sales_feed_credentials_platform_check" CHECK ("sales_feed_credentials"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "sales_feed_cursors" ADD CONSTRAINT "sales_feed_cursors_platform_check" CHECK ("sales_feed_cursors"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "sales_feed_deliveries" ADD CONSTRAINT "sales_feed_deliveries_platform_check" CHECK ("sales_feed_deliveries"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "sales_feed_models" ADD CONSTRAINT "sales_feed_models_platform_check" CHECK ("sales_feed_models"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "sales_feed_webhooks" ADD CONSTRAINT "sales_feed_webhooks_platform_check" CHECK ("sales_feed_webhooks"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_platform_check" CHECK ("platform_accounts"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera'));