-- The payout minimum is capped at 5 000 € (Charles, 06/11; PAYOUT_MINIMUM_MAX_MINOR): a slip guard on what the owner
-- types, nothing caps what a statement pays. NOT VALID: a minimum already written above it stays in the history as it
-- was (payout_minimums is append-only), only what is written from now on is checked.
ALTER TABLE "payout_minimums" DROP CONSTRAINT "payout_minimums_minimum_check";--> statement-breakpoint
ALTER TABLE "payroll_settings" DROP CONSTRAINT "payroll_settings_minimum_check";--> statement-breakpoint
ALTER TABLE "payout_minimums" ADD CONSTRAINT "payout_minimums_minimum_check" CHECK ("payout_minimums"."minimum_payout_minor" between 0 and 500000) NOT VALID;--> statement-breakpoint
ALTER TABLE "payroll_settings" ADD CONSTRAINT "payroll_settings_minimum_check" CHECK ("payroll_settings"."minimum_payout_minor" between 0 and 500000) NOT VALID;
