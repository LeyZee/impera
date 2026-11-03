CREATE TABLE "creator_availabilities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"weekday" integer,
	"start_minute" integer,
	"end_minute" integer,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_availabilities_kind_check" CHECK ("creator_availabilities"."kind" in ('weekly', 'once')),
	CONSTRAINT "creator_availabilities_when_check" CHECK ((
        "creator_availabilities"."kind" = 'weekly' and "creator_availabilities"."weekday" between 1 and 7 and "creator_availabilities"."start_minute" between 0 and 1439
          and "creator_availabilities"."end_minute" between 0 and 1439
          and "creator_availabilities"."starts_at" is null and "creator_availabilities"."ends_at" is null
      ) or (
        "creator_availabilities"."kind" = 'once' and "creator_availabilities"."ends_at" > "creator_availabilities"."starts_at" and "creator_availabilities"."ends_at" - "creator_availabilities"."starts_at" <= interval '1 day'
          and "creator_availabilities"."weekday" is null and "creator_availabilities"."start_minute" is null and "creator_availabilities"."end_minute" is null
      ))
);
--> statement-breakpoint
ALTER TABLE "creator_availabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"origin" text NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"purpose" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"day" date,
	"weekdays" integer[],
	"minutes" integer,
	"week" date NOT NULL,
	"state" text DEFAULT 'suggested' NOT NULL,
	"reason" text,
	"decided_at" timestamp with time zone,
	"decided_on" date,
	"task_id" uuid,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_suggestions_creator_unique" UNIQUE("id","creator_id"),
	CONSTRAINT "creator_suggestions_origin_check" CHECK ("creator_suggestions"."origin" in ('agency', 'ai')),
	CONSTRAINT "creator_suggestions_kind_check" CHECK ("creator_suggestions"."kind" in ('timed', 'day', 'routine')),
	CONSTRAINT "creator_suggestions_category_check" CHECK ("creator_suggestions"."category" in ('shoot', 'live', 'post', 'socials', 'appointment', 'personal')),
	CONSTRAINT "creator_suggestions_state_check" CHECK ("creator_suggestions"."state" in ('suggested', 'accepted', 'declined')),
	CONSTRAINT "creator_suggestions_when_check" CHECK (("creator_suggestions"."kind" = 'timed' and "creator_suggestions"."starts_at" is null and "creator_suggestions"."ends_at" is null and "creator_suggestions"."day" is null and "creator_suggestions"."weekdays" is null)
        or (
  ("creator_suggestions"."kind" = 'timed' and "creator_suggestions"."starts_at" is not null and "creator_suggestions"."ends_at" > "creator_suggestions"."starts_at"
    and "creator_suggestions"."ends_at" - "creator_suggestions"."starts_at" <= interval '1 day' and "creator_suggestions"."day" is null and "creator_suggestions"."weekdays" is null)
  or ("creator_suggestions"."kind" = 'day' and "creator_suggestions"."day" is not null and "creator_suggestions"."starts_at" is null and "creator_suggestions"."ends_at" is null and "creator_suggestions"."weekdays" is null)
  or ("creator_suggestions"."kind" = 'routine' and "creator_suggestions"."weekdays" is not null and cardinality("creator_suggestions"."weekdays") between 1 and 7
    and "creator_suggestions"."weekdays" <@ array[1, 2, 3, 4, 5, 6, 7] and "creator_suggestions"."starts_at" is null and "creator_suggestions"."ends_at" is null and "creator_suggestions"."day" is null)
)),
	CONSTRAINT "creator_suggestions_minutes_check" CHECK (("creator_suggestions"."kind" = 'timed') = ("creator_suggestions"."minutes" is not null) and coalesce("creator_suggestions"."minutes", 1) between 1 and 1440),
	CONSTRAINT "creator_suggestions_title_check" CHECK (char_length("creator_suggestions"."title") between 1 and 80),
	CONSTRAINT "creator_suggestions_purpose_check" CHECK ("creator_suggestions"."purpose" is null or char_length("creator_suggestions"."purpose") between 1 and 160),
	CONSTRAINT "creator_suggestions_reason_check" CHECK ("creator_suggestions"."reason" is null or ("creator_suggestions"."state" = 'declined' and char_length("creator_suggestions"."reason") between 1 and 200)),
	CONSTRAINT "creator_suggestions_week_check" CHECK (extract(isodow from "creator_suggestions"."week") = 1),
	CONSTRAINT "creator_suggestions_decision_check" CHECK (("creator_suggestions"."state" = 'suggested') = ("creator_suggestions"."decided_at" is null and "creator_suggestions"."decided_on" is null)
        and ("creator_suggestions"."state" = 'accepted') = ("creator_suggestions"."task_id" is not null)),
	CONSTRAINT "creator_suggestions_author_check" CHECK (("creator_suggestions"."origin" = 'agency') = ("creator_suggestions"."created_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "creator_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_task_ticks" (
	"task_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"day" date NOT NULL,
	"done_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_task_ticks_unique" UNIQUE("task_id","day")
);
--> statement-breakpoint
ALTER TABLE "creator_task_ticks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"purpose" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"day" date,
	"weekdays" integer[],
	"essential" boolean DEFAULT false NOT NULL,
	"reminder_minutes" integer,
	"suggestion_id" uuid,
	"created_by" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_tasks_suggestion_unique" UNIQUE("suggestion_id"),
	CONSTRAINT "creator_tasks_creator_unique" UNIQUE("id","creator_id"),
	CONSTRAINT "creator_tasks_kind_check" CHECK ("creator_tasks"."kind" in ('timed', 'day', 'routine')),
	CONSTRAINT "creator_tasks_category_check" CHECK ("creator_tasks"."category" in ('shoot', 'live', 'post', 'socials', 'appointment', 'personal')),
	CONSTRAINT "creator_tasks_when_check" CHECK ((
  ("creator_tasks"."kind" = 'timed' and "creator_tasks"."starts_at" is not null and "creator_tasks"."ends_at" > "creator_tasks"."starts_at"
    and "creator_tasks"."ends_at" - "creator_tasks"."starts_at" <= interval '1 day' and "creator_tasks"."day" is null and "creator_tasks"."weekdays" is null)
  or ("creator_tasks"."kind" = 'day' and "creator_tasks"."day" is not null and "creator_tasks"."starts_at" is null and "creator_tasks"."ends_at" is null and "creator_tasks"."weekdays" is null)
  or ("creator_tasks"."kind" = 'routine' and "creator_tasks"."weekdays" is not null and cardinality("creator_tasks"."weekdays") between 1 and 7
    and "creator_tasks"."weekdays" <@ array[1, 2, 3, 4, 5, 6, 7] and "creator_tasks"."starts_at" is null and "creator_tasks"."ends_at" is null and "creator_tasks"."day" is null)
)),
	CONSTRAINT "creator_tasks_title_check" CHECK (char_length("creator_tasks"."title") between 1 and 80),
	CONSTRAINT "creator_tasks_purpose_check" CHECK ("creator_tasks"."purpose" is null or char_length("creator_tasks"."purpose") between 1 and 160),
	CONSTRAINT "creator_tasks_reminder_check" CHECK ("creator_tasks"."reminder_minutes" is null or ("creator_tasks"."kind" = 'timed' and "creator_tasks"."reminder_minutes" between 0 and 1440)),
	CONSTRAINT "creator_tasks_essential_check" CHECK (not "creator_tasks"."essential" or ("creator_tasks"."kind" = 'routine' and "creator_tasks"."suggestion_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "creator_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_availabilities" ADD CONSTRAINT "creator_availabilities_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_availabilities" ADD CONSTRAINT "creator_availabilities_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD CONSTRAINT "creator_suggestions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD CONSTRAINT "creator_suggestions_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD CONSTRAINT "creator_suggestions_task_fk" FOREIGN KEY ("task_id","creator_id") REFERENCES "public"."creator_tasks"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_task_ticks" ADD CONSTRAINT "creator_task_ticks_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_task_ticks" ADD CONSTRAINT "creator_task_ticks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_task_ticks" ADD CONSTRAINT "creator_task_ticks_task_fk" FOREIGN KEY ("task_id","creator_id") REFERENCES "public"."creator_tasks"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD CONSTRAINT "creator_tasks_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD CONSTRAINT "creator_tasks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_tasks" ADD CONSTRAINT "creator_tasks_suggestion_fk" FOREIGN KEY ("suggestion_id","creator_id") REFERENCES "public"."creator_suggestions"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_availabilities_creator_idx" ON "creator_availabilities" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX "creator_suggestions_creator_week_idx" ON "creator_suggestions" USING btree ("creator_id","week");--> statement-breakpoint
CREATE INDEX "creator_task_ticks_creator_day_idx" ON "creator_task_ticks" USING btree ("creator_id","day");--> statement-breakpoint
CREATE INDEX "creator_tasks_creator_starts_idx" ON "creator_tasks" USING btree ("creator_id","starts_at");--> statement-breakpoint
CREATE INDEX "creator_tasks_creator_day_idx" ON "creator_tasks" USING btree ("creator_id","day");--> statement-breakpoint
CREATE POLICY "creator_read" ON "creator_availabilities" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_availabilities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "creator_availabilities" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_availabilities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_availabilities"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_update" ON "creator_availabilities" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_availabilities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_availabilities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_availabilities" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_availabilities"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_read" ON "creator_suggestions" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_suggestions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_decide" ON "creator_suggestions" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_suggestions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_suggestions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_suggestions" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_suggestions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_insert" ON "creator_suggestions" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_suggestions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_suggestions"."origin" = 'agency' and "creator_suggestions"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_read" ON "creator_task_ticks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_task_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "creator_task_ticks" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_task_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_task_ticks"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "creator_delete" ON "creator_task_ticks" AS PERMISSIVE FOR DELETE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_task_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_task_ticks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_task_ticks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_read" ON "creator_tasks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_tasks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "creator_tasks" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_tasks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_tasks"."created_by" = nullif(current_setting('app.user_id', true), '') and (not "creator_tasks"."essential" or exists (
        select 1 from creator_suggestions s
         where s.id = "creator_tasks"."suggestion_id" and s.creator_id = "creator_tasks"."creator_id" and s.kind = 'routine' and s.state = 'suggested'
      )));--> statement-breakpoint
CREATE POLICY "creator_update" ON "creator_tasks" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_tasks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_tasks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_tasks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_tasks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "creator_tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_task_ticks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_availabilities" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_suggestions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- CR-05: her agenda. Nothing is deleted but a tick she takes back; she never changes whether a task is essential, nor
-- what a suggestion proposes, only her decision on it.
REVOKE ALL ON "creator_tasks", "creator_task_ticks", "creator_availabilities", "creator_suggestions" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_tasks", "creator_availabilities", "creator_suggestions" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("kind", "category", "title", "purpose", "starts_at", "ends_at", "day", "weekdays", "reminder_minutes", "archived_at", "updated_at") ON "creator_tasks" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("archived_at") ON "creator_availabilities" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("state", "reason", "decided_at", "decided_on", "task_id", "updated_at") ON "creator_suggestions" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "creator_task_ticks" TO nirvana_app;
