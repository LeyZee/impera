-- VEI-01 lot a (ADR 0060): trend signals, the extension's readings, content ideas, and the link of one person's extension.
CREATE TABLE "content_ideas" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"signal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"to_shoot" text NOT NULL,
	"reason" text NOT NULL,
	"shoot_minutes" integer NOT NULL,
	"state" text DEFAULT 'proposed' NOT NULL,
	"proposed_on" date NOT NULL,
	"refusal_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_ideas_category_check" CHECK ("content_ideas"."category" in ('feed_shoot', 'feed_video', 'script', 'mass_dm', 'reveal_story', 'instagram_story', 'instagram_reel', 'instagram_post', 'telegram_post')),
	CONSTRAINT "content_ideas_state_check" CHECK ("content_ideas"."state" in ('proposed', 'validated', 'refused', 'suggested', 'deposited')),
	CONSTRAINT "content_ideas_texts_check" CHECK (char_length("content_ideas"."title") between 1 and 120 and char_length("content_ideas"."to_shoot") between 1 and 600 and char_length("content_ideas"."reason") between 1 and 200),
	CONSTRAINT "content_ideas_shoot_minutes_check" CHECK ("content_ideas"."shoot_minutes" between 1 and 600),
	CONSTRAINT "content_ideas_refusal_check" CHECK ("content_ideas"."refusal_reason" is null or ("content_ideas"."state" = 'refused' and char_length("content_ideas"."refusal_reason") between 1 and 280)),
	CONSTRAINT "content_ideas_decided_check" CHECK (("content_ideas"."state" = 'proposed') = ("content_ideas"."decided_at" is null) and ("content_ideas"."decided_by" is null or "content_ideas"."decided_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "content_ideas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "extension_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "extension_links_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "extension_links_revoked_check" CHECK ("extension_links"."revoked_at" is null or "extension_links"."revoked_at" >= "extension_links"."created_at")
);
--> statement-breakpoint
CREATE TABLE "trend_readings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"recorded_by" text NOT NULL,
	"watch_session_id" uuid NOT NULL,
	"post_code" text NOT NULL,
	"path" text NOT NULL,
	"account" text,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"caption" text,
	"hashtags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sound" text,
	"dwell_ms" integer NOT NULL,
	"marked_for_creator_id" uuid,
	"first_seen_at" timestamp with time zone NOT NULL,
	"seen_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_readings_session_post_unique" UNIQUE("recorded_by","watch_session_id","post_code"),
	CONSTRAINT "trend_readings_path_check" CHECK ("trend_readings"."path" in ('post', 'reel')),
	CONSTRAINT "trend_readings_code_check" CHECK ("trend_readings"."post_code" ~ '^[A-Za-z0-9_-]{5,64}$'),
	CONSTRAINT "trend_readings_account_check" CHECK ("trend_readings"."account" is null or "trend_readings"."account" ~ '^[A-Za-z0-9._]{1,30}$'),
	CONSTRAINT "trend_readings_texts_check" CHECK (coalesce(char_length("trend_readings"."caption"), 0) <= 2200 and coalesce(char_length("trend_readings"."sound"), 1) between 1 and 200),
	CONSTRAINT "trend_readings_hashtags_check" CHECK (jsonb_typeof("trend_readings"."hashtags") = 'array' and jsonb_array_length("trend_readings"."hashtags") <= 30),
	CONSTRAINT "trend_readings_metrics_check" CHECK (coalesce("trend_readings"."views", 0) >= 0 and coalesce("trend_readings"."likes", 0) >= 0 and coalesce("trend_readings"."comments", 0) >= 0),
	CONSTRAINT "trend_readings_dwell_check" CHECK ("trend_readings"."dwell_ms" between 0 and 2700000),
	CONSTRAINT "trend_readings_seen_check" CHECK ("trend_readings"."seen_at" >= "trend_readings"."first_seen_at")
);
--> statement-breakpoint
ALTER TABLE "trend_readings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "trend_signals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"text" text NOT NULL,
	"url" text,
	"format" text,
	"views" integer,
	"likes" integer,
	"comments" integer,
	"reading_id" uuid,
	"created_by" text,
	"observed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trend_signals_reading_unique" UNIQUE("reading_id"),
	CONSTRAINT "trend_signals_source_check" CHECK ("trend_signals"."source" in ('creator_stats', 'grok_search', 'reference_account', 'agency_link', 'creator_link', 'passive_capture')),
	CONSTRAINT "trend_signals_kind_check" CHECK ("trend_signals"."kind" in ('format', 'sound', 'theme', 'date')),
	CONSTRAINT "trend_signals_format_check" CHECK ("trend_signals"."format" is null or "trend_signals"."format" in ('reel', 'photo', 'carousel', 'story')),
	CONSTRAINT "trend_signals_text_check" CHECK (char_length("trend_signals"."text") between 1 and 280),
	CONSTRAINT "trend_signals_url_check" CHECK ("trend_signals"."url" is null or char_length("trend_signals"."url") <= 2048),
	CONSTRAINT "trend_signals_metrics_check" CHECK (coalesce("trend_signals"."views", 0) >= 0 and coalesce("trend_signals"."likes", 0) >= 0 and coalesce("trend_signals"."comments", 0) >= 0),
	CONSTRAINT "trend_signals_lifetime_check" CHECK ("trend_signals"."expires_at" > "trend_signals"."observed_at"),
	CONSTRAINT "trend_signals_link_check" CHECK ("trend_signals"."source" not in ('agency_link', 'creator_link') or ("trend_signals"."url" is not null and "trend_signals"."created_by" is not null and "trend_signals"."creator_id" is not null and "trend_signals"."format" is not null)),
	CONSTRAINT "trend_signals_reading_check" CHECK (("trend_signals"."source" = 'passive_capture') = ("trend_signals"."reading_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "trend_signals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_signal_id_trend_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."trend_signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_ideas" ADD CONSTRAINT "content_ideas_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extension_links" ADD CONSTRAINT "extension_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_readings" ADD CONSTRAINT "trend_readings_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_readings" ADD CONSTRAINT "trend_readings_marked_for_creator_id_creators_id_fk" FOREIGN KEY ("marked_for_creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_signals" ADD CONSTRAINT "trend_signals_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_signals" ADD CONSTRAINT "trend_signals_reading_id_trend_readings_id_fk" FOREIGN KEY ("reading_id") REFERENCES "public"."trend_readings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trend_signals" ADD CONSTRAINT "trend_signals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_ideas_creator_day_idx" ON "content_ideas" USING btree ("creator_id","proposed_on");--> statement-breakpoint
CREATE UNIQUE INDEX "extension_links_live_unique" ON "extension_links" USING btree ("user_id") WHERE "extension_links"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "trend_readings_account_idx" ON "trend_readings" USING btree ("account","seen_at");--> statement-breakpoint
CREATE INDEX "trend_readings_marked_idx" ON "trend_readings" USING btree ("marked_for_creator_id","seen_at") WHERE "trend_readings"."marked_for_creator_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "trend_signals_link_unique" ON "trend_signals" USING btree ("creator_id","url") WHERE "trend_signals"."source" in ('agency_link', 'creator_link');--> statement-breakpoint
CREATE INDEX "trend_signals_creator_expiry_idx" ON "trend_signals" USING btree ("creator_id","expires_at");--> statement-breakpoint
CREATE POLICY "team_all" ON "content_ideas" AS PERMISSIVE FOR ALL TO public USING ("content_ideas"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency')) WITH CHECK ("content_ideas"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "recorder_all" ON "trend_readings" AS PERMISSIVE FOR ALL TO public USING ("trend_readings"."recorded_by" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("trend_readings"."recorded_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "team_read" ON "trend_readings" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency'));--> statement-breakpoint
CREATE POLICY "creator_marks_her_own" ON "trend_readings" AS RESTRICTIVE FOR ALL TO public USING (true) WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' or "trend_readings"."marked_for_creator_id" is null or "trend_readings"."marked_for_creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_read" ON "trend_signals" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and ("trend_signals"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid or "trend_signals"."creator_id" is null));--> statement-breakpoint
CREATE POLICY "member_link_insert" ON "trend_signals" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') is not null and "trend_signals"."source" = 'agency_link' and "trend_signals"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "trend_signals"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_link_insert" ON "trend_signals" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "trend_signals"."source" = 'creator_link' and "trend_signals"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "trend_signals"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
-- Written by hand (VEI-01). Drizzle does not write what follows.
-- From nothing, whatever the default privileges of the base gave. A signal is added, never changed nor removed by the
-- application (it expires; the jobs write through `withAdmin`); a reading is updated when its post is seen again; an
-- idea is decided. The extension's links are read through `withAdmin` only, like `calendar_links` (0076).
REVOKE ALL ON "trend_signals", "trend_readings", "content_ideas", "extension_links" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "trend_signals" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "trend_readings", "content_ideas" TO nirvana_app;