-- Her week (ADR 0140): additive. `creator_weeks`, the week the code proposes, one per creator and Monday: written by
-- the job (service role), read by her team, validated by the owner only, never read by her. `creator_shoot_items`, the
-- lines of a « Jour de tournage »: written by the owner with the day he validates, read by her, ticked by her once she
-- accepted the day (her column grant), never deleted. `creator_suggestions.week_role` marks the frames of her week.
CREATE TABLE "creator_shoot_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"suggestion_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"need" text NOT NULL,
	"label" text NOT NULL,
	"sheet" text,
	"count" integer NOT NULL,
	"request_id" uuid,
	"done_at" timestamp with time zone,
	"done_by" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_shoot_items_position_unique" UNIQUE("suggestion_id","position"),
	CONSTRAINT "creator_shoot_items_need_check" CHECK ("creator_shoot_items"."need" in ('script', 'feed_shoot', 'feed_video', 'mass_dm', 'idea', 'reveal_story')),
	CONSTRAINT "creator_shoot_items_label_check" CHECK (char_length("creator_shoot_items"."label") between 1 and 120),
	CONSTRAINT "creator_shoot_items_sheet_check" CHECK ("creator_shoot_items"."sheet" is null or char_length("creator_shoot_items"."sheet") between 1 and 600),
	CONSTRAINT "creator_shoot_items_count_check" CHECK ("creator_shoot_items"."count" between 1 and 50),
	CONSTRAINT "creator_shoot_items_position_check" CHECK ("creator_shoot_items"."position" between 0 and 19),
	CONSTRAINT "creator_shoot_items_request_check" CHECK ("creator_shoot_items"."request_id" is null or "creator_shoot_items"."need" = 'script'),
	CONSTRAINT "creator_shoot_items_done_check" CHECK (("creator_shoot_items"."done_at" is null) = ("creator_shoot_items"."done_by" is null))
);
--> statement-breakpoint
ALTER TABLE "creator_shoot_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_weeks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"week" date NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"plan" jsonb NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	"validated_by" text,
	"validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_weeks_creator_week_unique" UNIQUE("creator_id","week"),
	CONSTRAINT "creator_weeks_state_check" CHECK ("creator_weeks"."state" in ('draft', 'validated')),
	CONSTRAINT "creator_weeks_week_check" CHECK (extract(isodow from "creator_weeks"."week") = 1),
	CONSTRAINT "creator_weeks_plan_check" CHECK (jsonb_typeof("creator_weeks"."plan") = 'object'),
	CONSTRAINT "creator_weeks_validation_check" CHECK (("creator_weeks"."state" = 'validated') = ("creator_weeks"."validated_at" is not null)
        and ("creator_weeks"."validated_at" is null) = ("creator_weeks"."validated_by" is null))
);
--> statement-breakpoint
ALTER TABLE "creator_weeks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD COLUMN "week_role" text;--> statement-breakpoint
ALTER TABLE "creator_shoot_items" ADD CONSTRAINT "creator_shoot_items_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_shoot_items" ADD CONSTRAINT "creator_shoot_items_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_shoot_items" ADD CONSTRAINT "creator_shoot_items_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_shoot_items" ADD CONSTRAINT "creator_shoot_items_suggestion_fk" FOREIGN KEY ("suggestion_id","creator_id") REFERENCES "public"."creator_suggestions"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_shoot_items" ADD CONSTRAINT "creator_shoot_items_request_fk" FOREIGN KEY ("request_id","creator_id") REFERENCES "public"."content_requests"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_weeks" ADD CONSTRAINT "creator_weeks_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_weeks" ADD CONSTRAINT "creator_weeks_validated_by_user_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_shoot_items_creator_idx" ON "creator_shoot_items" USING btree ("creator_id");--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD CONSTRAINT "creator_suggestions_week_role_check" CHECK ("creator_suggestions"."week_role" in ('shoot_day', 'delivery'));--> statement-breakpoint
ALTER TABLE "creator_suggestions" ADD CONSTRAINT "creator_suggestions_week_role_shape_check" CHECK ("creator_suggestions"."week_role" is null or ("creator_suggestions"."kind" = 'day' and "creator_suggestions"."category" = 'shoot'));--> statement-breakpoint
CREATE POLICY "creator_read" ON "creator_shoot_items" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_shoot_items"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_tick" ON "creator_shoot_items" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_shoot_items"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (
        select 1 from creator_suggestions s
         where s.id = "creator_shoot_items"."suggestion_id" and s.creator_id = "creator_shoot_items"."creator_id" and s.state = 'accepted'
      )) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_shoot_items"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and ("creator_shoot_items"."done_by" is null or "creator_shoot_items"."done_by" = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_shoot_items" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_shoot_items"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "team_insert" ON "creator_shoot_items" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_shoot_items"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_shoot_items"."created_by" = nullif(current_setting('app.user_id', true), '') and "creator_shoot_items"."done_at" is null
        and exists (
          select 1 from creator_suggestions s
           where s.id = "creator_shoot_items"."suggestion_id" and s.creator_id = "creator_shoot_items"."creator_id" and s.week_role = 'shoot_day'
             and s.state = 'suggested'
        ));--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_weeks" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "creator_weeks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_validate" ON "creator_weeks" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_weeks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_weeks"."state" = 'draft') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_weeks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_weeks"."state" = 'validated' and "creator_weeks"."validated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "creator_shoot_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_weeks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave.
REVOKE ALL ON "creator_shoot_items", "creator_weeks" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "creator_shoot_items", "creator_weeks" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_shoot_items" TO nirvana_app;--> statement-breakpoint
-- Her tick only: what a line says never changes once written.
GRANT UPDATE ("done_at", "done_by") ON "creator_shoot_items" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_weeks" TO nirvana_app;--> statement-breakpoint
-- The owner's validation: the plan as he corrected it, and his name.
GRANT UPDATE ("state", "plan", "validated_by", "validated_at", "updated_at") ON "creator_weeks" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_shoot_items" TO impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_weeks" TO impera_service;--> statement-breakpoint
-- The job refreshes a draft on the stock of now; a validated week is never touched (checked in its statement).
GRANT UPDATE ("plan", "computed_at", "updated_at") ON "creator_weeks" TO impera_service;
