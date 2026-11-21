-- ADR 0159 § A: his custom orders, what the agent understood of his request before and after her yes.
CREATE TABLE "custom_orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"fan_id" uuid NOT NULL,
	"state" text NOT NULL,
	"format" text,
	"supplements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"minutes" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"questions_asked" integer DEFAULT 0 NOT NULL,
	"card" jsonb,
	"last_inbound_message_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_orders_state_check" CHECK ("custom_orders"."state" in ('gathering', 'awaiting_creator', 'creator_yes', 'creator_no', 'deposit_paid', 'delivered', 'expired', 'cancelled')),
	CONSTRAINT "custom_orders_questions_asked_check" CHECK ("custom_orders"."questions_asked" >= 0),
	CONSTRAINT "custom_orders_minutes_check" CHECK ("custom_orders"."minutes" is null or "custom_orders"."minutes" >= 1),
	CONSTRAINT "custom_orders_supplements_check" CHECK (jsonb_typeof("custom_orders"."supplements") = 'array'),
	CONSTRAINT "custom_orders_details_check" CHECK (jsonb_typeof("custom_orders"."details") = 'object'),
	CONSTRAINT "custom_orders_card_check" CHECK ("custom_orders"."card" is null or jsonb_typeof("custom_orders"."card") = 'object')
);
--> statement-breakpoint
ALTER TABLE "fans" ADD CONSTRAINT "fans_id_creator_unique" UNIQUE("id","creator_id");--> statement-breakpoint
ALTER TABLE "custom_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD CONSTRAINT "custom_orders_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_orders" ADD CONSTRAINT "custom_orders_fan_creator_fk" FOREIGN KEY ("fan_id","creator_id") REFERENCES "public"."fans"("id","creator_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_orders_open_per_fan" ON "custom_orders" USING btree ("creator_id","fan_id") WHERE "custom_orders"."state" in ('gathering', 'awaiting_creator');--> statement-breakpoint
CREATE INDEX "custom_orders_fan_message" ON "custom_orders" USING btree ("creator_id","fan_id","last_inbound_message_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_orders" AS PERMISSIVE FOR ALL TO public USING ("custom_orders"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("custom_orders"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "custom_orders" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
-- ADR 0159 § A: his custom orders. Read and written by the agent's turn under her RLS (`withTenant`); her own account
-- reads nothing yet. Never deleted by the app: an order ends by its state. The service role only reads. The fan is tied
-- to the order's creator (`custom_orders_fan_creator_fk`, on the new `fans_id_creator_unique`).
ALTER TABLE "custom_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "custom_orders" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "custom_orders" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "custom_orders" TO impera_service;
