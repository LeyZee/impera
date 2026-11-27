-- Her day (ADR 0140, second avenant of 20/11/2026): additive. `creator_day_ticks`, how many of a line of her day she
-- did, one row a day and a line: written by her alone (her account, today or yesterday, checked by the code), read by
-- her team, never deleted. What a line asks is the code's, never stored.
CREATE TABLE "creator_day_ticks" (
	"creator_id" uuid NOT NULL,
	"day" date NOT NULL,
	"item" text NOT NULL,
	"done" integer NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_day_ticks_pkey" PRIMARY KEY("creator_id","day","item"),
	CONSTRAINT "creator_day_ticks_item_check" CHECK ("creator_day_ticks"."item" in ('reveal_story', 'reveal_video', 'insta_cta_story', 'insta_stories', 'insta_posts', 'insta_reel', 'telegram_posts', 'telegram_video')),
	CONSTRAINT "creator_day_ticks_done_check" CHECK ("creator_day_ticks"."done" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "creator_day_ticks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_day_ticks" ADD CONSTRAINT "creator_day_ticks_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_day_ticks" ADD CONSTRAINT "creator_day_ticks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_day_ticks" ADD CONSTRAINT "creator_day_ticks_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "creator_read" ON "creator_day_ticks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_day_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "creator_day_ticks" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_day_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_day_ticks"."created_by" = nullif(current_setting('app.user_id', true), '') and "creator_day_ticks"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_update" ON "creator_day_ticks" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_day_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_day_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_day_ticks"."updated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_day_ticks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_day_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "creator_day_ticks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave.
REVOKE ALL ON "creator_day_ticks" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "creator_day_ticks" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_day_ticks" TO nirvana_app;--> statement-breakpoint
-- Her count only: the day and the line of a row never change.
GRANT UPDATE ("done", "updated_by", "updated_at") ON "creator_day_ticks" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_day_ticks" TO impera_service;
