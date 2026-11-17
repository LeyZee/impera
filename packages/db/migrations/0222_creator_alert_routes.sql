CREATE TABLE "creator_alert_routes" (
	"creator_id" uuid NOT NULL,
	"alert_code" text NOT NULL,
	"role" text NOT NULL,
	"mode" text NOT NULL,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_alert_routes_pkey" PRIMARY KEY("creator_id","alert_code","role"),
	CONSTRAINT "creator_alert_routes_alert_code_check" CHECK ("creator_alert_routes"."alert_code" in ('safety_handoff', 'identity_doubt', 'sale', 'offer_proposed', 'script_price', 'scripts_exhausted', 'her_alerts', 'ai_budget', 'session_expired')),
	CONSTRAINT "creator_alert_routes_role_check" CHECK ("creator_alert_routes"."role" in ('owner', 'manager', 'chatter_on_shift')),
	CONSTRAINT "creator_alert_routes_mode_check" CHECK ("creator_alert_routes"."mode" in ('deliver', 'muted', 'off')),
	CONSTRAINT "creator_alert_routes_locked_check" CHECK ("creator_alert_routes"."alert_code" not in ('safety_handoff') or "creator_alert_routes"."mode" = 'deliver')
);
--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ADD CONSTRAINT "creator_alert_routes_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_alert_routes" ADD CONSTRAINT "creator_alert_routes_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "creator_alert_routes" AS PERMISSIVE FOR ALL TO public USING ("creator_alert_routes"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("creator_alert_routes"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "creator_alert_routes" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- Who each alert of hers reaches, by role (ADR 0150): written by the owner through the API under her RLS, closed to her
-- account; read by the alert router as the service role.
ALTER TABLE "creator_alert_routes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "creator_alert_routes" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "creator_alert_routes" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_alert_routes" TO impera_service;
