-- Réglages › Modèles IA › Budget IA (choix de Charles 12/11): the day's AI budget and the trend watch's cap set by the
-- owner, in euro cents, null for the code's default. One row for the agency, out of tenancy: RLS forced, `agency_only`.
CREATE TABLE "ai_budget_settings" (
	"id" integer PRIMARY KEY NOT NULL,
	"daily_cap_minor" integer,
	"trend_watch_cap_minor" integer,
	"updated_by" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "ai_budget_settings_single_row_check" CHECK ("ai_budget_settings"."id" = 1),
	CONSTRAINT "ai_budget_settings_daily_cap_check" CHECK ("ai_budget_settings"."daily_cap_minor" is null or "ai_budget_settings"."daily_cap_minor" between 100 and 20000),
	CONSTRAINT "ai_budget_settings_trend_watch_cap_check" CHECK ("ai_budget_settings"."trend_watch_cap_minor" is null or "ai_budget_settings"."trend_watch_cap_minor" between 10 and 2000)
);
--> statement-breakpoint
ALTER TABLE "ai_budget_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_budget_settings" ADD CONSTRAINT "ai_budget_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "agency_only" ON "ai_budget_settings" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
ALTER TABLE "ai_budget_settings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "ai_budget_settings" TO nirvana_app;
