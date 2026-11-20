-- ADR 0159 § C: her grid of custom prices (Charles, 20/11/2026), one version per save, the owner's alone.
CREATE TABLE "custom_price_grids" (
	"creator_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"grid" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_price_grids_pkey" PRIMARY KEY("creator_id","version"),
	CONSTRAINT "custom_price_grids_version_check" CHECK ("custom_price_grids"."version" >= 1),
	CONSTRAINT "custom_price_grids_grid_check" CHECK (jsonb_typeof("custom_price_grids"."grid") = 'object')
);
--> statement-breakpoint
ALTER TABLE "custom_price_grids" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_price_grids" ADD CONSTRAINT "custom_price_grids_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_price_grids" ADD CONSTRAINT "custom_price_grids_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "creator_closed" ON "custom_price_grids" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "owner_read" ON "custom_price_grids" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner' and "custom_price_grids"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
-- ADR 0159 § C: her grid of custom prices, one row per save. The owner reads it under her RLS (`owner_read`); a manager,
-- a chatter and her own account read nothing. Written by the server alone, as the service role after the owner's
-- check: the application role only selects.
ALTER TABLE "custom_price_grids" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "custom_price_grids" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "custom_price_grids" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "custom_price_grids" TO impera_service;
