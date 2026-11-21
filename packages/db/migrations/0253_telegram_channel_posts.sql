-- ADR 0162: the posts of her channel's week, planned on Saturday evening, reviewed by the owner and her, sent at their
-- hour. RLS forced; read and written by the app role through the `telegram_channel` job's policies only (below), one
-- creator at a time; the routes check who asks first.
CREATE TABLE "telegram_channel_posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"week" date NOT NULL,
	"day" date NOT NULL,
	"plan_key" text NOT NULL,
	"window_from" integer NOT NULL,
	"window_until" integer NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"role" text NOT NULL,
	"kind" text NOT NULL,
	"theme" text NOT NULL,
	"draft" jsonb,
	"media_id" uuid,
	"why" text,
	"repost" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'planned' NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"review" jsonb,
	"reviewed_by" text,
	"replaces_id" uuid,
	"reason" text,
	"telegram_message_id" bigint,
	"sent_at" timestamp with time zone,
	"reactions" integer,
	"clicks" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_channel_posts_plan_key_unique" UNIQUE("creator_id","plan_key"),
	CONSTRAINT "telegram_channel_posts_role_check" CHECK ("telegram_channel_posts"."role" in ('main', 'engagement')),
	CONSTRAINT "telegram_channel_posts_kind_check" CHECK ("telegram_channel_posts"."kind" in ('text', 'photo', 'poll', 'main')),
	CONSTRAINT "telegram_channel_posts_theme_check" CHECK ("telegram_channel_posts"."theme" in ('girly', 'passion', 'chat', 'news', 'poll', 'evening')),
	CONSTRAINT "telegram_channel_posts_state_check" CHECK ("telegram_channel_posts"."state" in ('planned', 'sent', 'removed', 'skipped', 'failed')),
	CONSTRAINT "telegram_channel_posts_week_check" CHECK (extract(isodow from "telegram_channel_posts"."week") = 1),
	CONSTRAINT "telegram_channel_posts_window_check" CHECK ("telegram_channel_posts"."window_from" between 0 and 1439 and "telegram_channel_posts"."window_until" between "telegram_channel_posts"."window_from" and 1439),
	CONSTRAINT "telegram_channel_posts_sent_check" CHECK (("telegram_channel_posts"."state" = 'sent') = ("telegram_channel_posts"."sent_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "telegram_channel_posts" ADD CONSTRAINT "telegram_channel_posts_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_channel_posts" ADD CONSTRAINT "telegram_channel_posts_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "telegram_channel_posts_due_idx" ON "telegram_channel_posts" USING btree ("state","at");--> statement-breakpoint
CREATE INDEX "telegram_channel_posts_week_idx" ON "telegram_channel_posts" USING btree ("creator_id","week");--> statement-breakpoint
ALTER TABLE "telegram_channel_posts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_channel_posts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- Planned, reviewed and sent under the app role, one creator at a time (withTenantJob, app.job = 'telegram_channel'):
-- read, inserted, changed by that job's policies only; never deleted (a removed post stays, its replacement points at
-- it). The service role reads it, writes nothing.
REVOKE ALL ON "telegram_channel_posts" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "telegram_channel_posts" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "telegram_channel_posts" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "telegram_channel_posts" TO impera_service;--> statement-breakpoint
CREATE POLICY "telegram_channel_read" ON "telegram_channel_posts" AS PERMISSIVE FOR SELECT TO public USING ("telegram_channel_posts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel');--> statement-breakpoint
CREATE POLICY "telegram_channel_insert" ON "telegram_channel_posts" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("telegram_channel_posts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel');--> statement-breakpoint
CREATE POLICY "telegram_channel_update" ON "telegram_channel_posts" AS PERMISSIVE FOR UPDATE TO public USING ("telegram_channel_posts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel') WITH CHECK ("telegram_channel_posts"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel');--> statement-breakpoint
-- Her channel's week reads, under the app role and in her creator only (withTenantJob, app.job = 'telegram_channel'),
-- the visuals it may send and which of them are in a script; no account's session sets app.job. Nothing written.
CREATE POLICY "telegram_channel_read" ON "content_drop_files" AS PERMISSIVE FOR SELECT TO public USING ("content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel');--> statement-breakpoint
CREATE POLICY "telegram_channel_read" ON "content_drops" AS PERMISSIVE FOR SELECT TO public USING ("content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel');--> statement-breakpoint
CREATE POLICY "telegram_channel_read" ON "platform_script_step_media" AS PERMISSIVE FOR SELECT TO public USING ("platform_script_step_media"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'telegram_channel');