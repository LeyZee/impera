-- ADR 0129 § 12 (SCB-04 lot 4 a). Additive. `platform_script_step_daily`: the platform's totals of a step (sends, packs
-- paid, what they brought, every seller together, since the step exists), one row a day, written by the import of her
-- scripts as the service role (`withAdmin`), over the row of the same day. Read by the agency like her native scripts;
-- closed to a creator's own account. Nothing is ever removed by the code.
CREATE TABLE "platform_script_step_daily" (
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"platform_step_ref" text NOT NULL,
	"day" date NOT NULL,
	"sent" integer NOT NULL,
	"purchased" integer NOT NULL,
	"paid_minor" integer NOT NULL,
	"currency" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	CONSTRAINT "platform_script_step_daily_pkey" PRIMARY KEY("platform_account_id","platform_step_ref","day"),
	CONSTRAINT "platform_script_step_daily_counts_check" CHECK ("platform_script_step_daily"."sent" >= 0 and "platform_script_step_daily"."purchased" >= 0 and "platform_script_step_daily"."paid_minor" >= 0),
	CONSTRAINT "platform_script_step_daily_ref_check" CHECK (char_length("platform_script_step_daily"."platform_step_ref") <= 200),
	CONSTRAINT "platform_script_step_daily_currency_check" CHECK ("platform_script_step_daily"."currency" in ('EUR', 'USD'))
);
--> statement-breakpoint
ALTER TABLE "platform_script_step_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "platform_script_step_daily" ADD CONSTRAINT "platform_script_step_daily_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_script_step_daily" ADD CONSTRAINT "platform_script_step_daily_platform_account_id_platform_accounts_id_fk" FOREIGN KEY ("platform_account_id") REFERENCES "public"."platform_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_script_step_daily_creator_day_idx" ON "platform_script_step_daily" USING btree ("creator_id","day");--> statement-breakpoint
CREATE POLICY "team_read" ON "platform_script_step_daily" AS PERMISSIVE FOR SELECT TO public USING ("platform_script_step_daily"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "creator_closed" ON "platform_script_step_daily" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
ALTER TABLE "platform_script_step_daily" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the agency only reads, the import writes a day and its later read.
REVOKE ALL ON "platform_script_step_daily" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "platform_script_step_daily" FROM impera_service;--> statement-breakpoint
GRANT SELECT ON "platform_script_step_daily" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "platform_script_step_daily" TO impera_service;
