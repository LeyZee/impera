-- Why pay's job could not compute a period at its last try (EQ-04, recette du 28/10, Équipe G1): until now a blocked
-- recalculation was only a line in the job's log, and the period read as up to date on stale figures. One row per
-- period at most, written and deleted by the job (`nirvana_admin`) under `payroll.close`; read like `pay_periods`.
CREATE TABLE "pay_period_blocks" (
	"period" date PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"member_ids" uuid[],
	"currency" text,
	"since" timestamp with time zone NOT NULL,
	CONSTRAINT "pay_period_blocks_period_check" CHECK (extract(day from "pay_period_blocks"."period") in (1, 16)),
	CONSTRAINT "pay_period_blocks_code_check" CHECK ("pay_period_blocks"."code" in ('commission_rate_missing_conflict', 'exchange_rate_missing_conflict')),
	CONSTRAINT "pay_period_blocks_currency_check" CHECK ("pay_period_blocks"."currency" in ('USD')),
	CONSTRAINT "pay_period_blocks_reason_check" CHECK (("pay_period_blocks"."code" = 'commission_rate_missing_conflict' and cardinality("pay_period_blocks"."member_ids") > 0 and "pay_period_blocks"."currency" is null) or ("pay_period_blocks"."code" = 'exchange_rate_missing_conflict' and "pay_period_blocks"."member_ids" is null and "pay_period_blocks"."currency" is not null))
);
--> statement-breakpoint
ALTER TABLE "pay_period_blocks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pay_period_blocks" ADD CONSTRAINT "pay_period_blocks_period_pay_periods_period_fk" FOREIGN KEY ("period") REFERENCES "public"."pay_periods"("period") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "team_read" ON "pay_period_blocks" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') is not null);--> statement-breakpoint
-- Written by hand. Drizzle does not write what follows.
ALTER TABLE "pay_period_blocks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave: the application reads, the job alone writes.
REVOKE ALL ON "pay_period_blocks" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "pay_period_blocks" TO nirvana_app;
