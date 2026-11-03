-- The settings of a Telegram topic (ADR 0020 §6), for one creator or for all of them (`creator_id` null): today the
-- sales topic only (CRM-04 lot b: minimum price, the agent's sales only, the evening digest). Agency settings, out of
-- RLS and out of reach of `nirvana_app`, like the other telegram tables (0006): only `withAdmin` reads or writes them.
CREATE TABLE "telegram_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid,
	"topic" text NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_settings_unique" UNIQUE NULLS NOT DISTINCT("creator_id","topic"),
	CONSTRAINT "telegram_settings_topic_check" CHECK ("telegram_settings"."topic" in ('sale'))
);
--> statement-breakpoint
ALTER TABLE "telegram_settings" ADD CONSTRAINT "telegram_settings_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
REVOKE ALL ON "telegram_settings" FROM nirvana_app;
