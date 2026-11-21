-- ADR 0162. Additive. `creator_decisions`: a question put to a creator about a content of hers, with two or three
-- answers. Written by the code that asks under the app role, one creator at a time (withTenantJob, app.job =
-- 'creator_decisions'), once per subject. She reads her own and answers it or puts it aside; the owner reads and
-- answers in her place; nobody else reads it. A row that is no longer open matches no policy that changes it, and
-- the app role may change only the columns of an answer.
CREATE TABLE "creator_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"subject" text NOT NULL,
	"category" text NOT NULL,
	"question" text NOT NULL,
	"context" text NOT NULL,
	"layout" text NOT NULL,
	"answers" jsonb NOT NULL,
	"other_ideas_left" integer DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"answer_key" text,
	"answered_at" timestamp with time zone,
	"answered_by" text,
	"later_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_decisions_subject_unique" UNIQUE("creator_id","kind","subject"),
	CONSTRAINT "creator_decisions_kind_check" CHECK ("creator_decisions"."kind" in ('caption', 'publish_time', 'trial_reel')),
	CONSTRAINT "creator_decisions_category_check" CHECK ("creator_decisions"."category" in ('shoot', 'live', 'post', 'socials', 'appointment', 'personal')),
	CONSTRAINT "creator_decisions_layout_check" CHECK ("creator_decisions"."layout" in ('buttons', 'rows')),
	CONSTRAINT "creator_decisions_state_check" CHECK ("creator_decisions"."state" in ('open', 'answered', 'withdrawn')),
	CONSTRAINT "creator_decisions_text_check" CHECK (char_length("creator_decisions"."question") between 1 and 120 and char_length("creator_decisions"."context") between 1 and 200 and char_length("creator_decisions"."subject") between 1 and 64),
	CONSTRAINT "creator_decisions_answers_check" CHECK (jsonb_typeof("creator_decisions"."answers") = 'array' and jsonb_array_length("creator_decisions"."answers") between 2 and 3),
	CONSTRAINT "creator_decisions_other_ideas_check" CHECK ("creator_decisions"."other_ideas_left" between 0 and 3),
	CONSTRAINT "creator_decisions_answered_check" CHECK (("creator_decisions"."state" = 'answered') = ("creator_decisions"."answer_key" is not null and "creator_decisions"."answered_at" is not null and "creator_decisions"."answered_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "creator_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_decisions" ADD CONSTRAINT "creator_decisions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_decisions" ADD CONSTRAINT "creator_decisions_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_decisions_open_idx" ON "creator_decisions" USING btree ("creator_id","state","expires_at");--> statement-breakpoint
CREATE POLICY "hers_read" ON "creator_decisions" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "hers_answer" ON "creator_decisions" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_decisions"."state" = 'open') WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_read" ON "creator_decisions" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_answer" ON "creator_decisions" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_decisions"."state" = 'open') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "asking_read" ON "creator_decisions" AS PERMISSIVE FOR SELECT TO public USING ("creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'creator_decisions');--> statement-breakpoint
CREATE POLICY "asking_insert" ON "creator_decisions" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'creator_decisions');--> statement-breakpoint
CREATE POLICY "asking_withdraw" ON "creator_decisions" AS PERMISSIVE FOR UPDATE TO public USING ("creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'creator_decisions' and "creator_decisions"."state" = 'open') WITH CHECK ("creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'creator_decisions' and "creator_decisions"."state" = 'withdrawn');--> statement-breakpoint
-- From nothing, whatever the default privileges gave: nobody removes a decision, nobody rewrites its question, and
-- the service role only reads.
REVOKE ALL ON "creator_decisions" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "creator_decisions" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_decisions" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("state", "answer_key", "answered_at", "answered_by", "later_until", "updated_at") ON "creator_decisions" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_decisions" TO impera_service;
