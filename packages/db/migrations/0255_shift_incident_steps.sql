CREATE TABLE "shift_incident_steps" (
	"shift_feedback_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"step" text NOT NULL,
	"said_by" text NOT NULL,
	"said_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_incident_steps_shift_feedback_id_step_pk" PRIMARY KEY("shift_feedback_id","step"),
	CONSTRAINT "shift_incident_steps_step_check" CHECK ("shift_incident_steps"."step" in ('seen', 'resolved'))
);
--> statement-breakpoint
ALTER TABLE "shift_incident_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_incident_steps" ADD CONSTRAINT "shift_incident_steps_shift_feedback_id_shift_feedbacks_id_fk" FOREIGN KEY ("shift_feedback_id") REFERENCES "public"."shift_feedbacks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_incident_steps" ADD CONSTRAINT "shift_incident_steps_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_incident_steps" ADD CONSTRAINT "shift_incident_steps_said_by_user_id_fk" FOREIGN KEY ("said_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "feedback_read" ON "shift_incident_steps" AS PERMISSIVE FOR SELECT TO public USING ("shift_incident_steps"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from shift_feedbacks f where f.id = "shift_incident_steps"."shift_feedback_id"));--> statement-breakpoint
CREATE POLICY "agency_insert" ON "shift_incident_steps" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shift_incident_steps"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "shift_incident_steps"."said_by" = nullif(current_setting('app.user_id', true), '') and "shift_incident_steps"."said_at" = now() and exists (select 1 from shift_feedbacks f where f.id = "shift_incident_steps"."shift_feedback_id" and f.creator_id = "shift_incident_steps"."creator_id" and f.incident is not null and not exists (select 1 from team_members m where m.id = f.member_id and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
-- The follow-up of an incident of the mini feedback (trous béants n° 1, 21/11): « Vu », « Réglé », each once, never
-- undone nor deleted. Forced, so that even the table's owner goes through RLS.
ALTER TABLE "shift_incident_steps" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "shift_incident_steps_append_only" BEFORE UPDATE OR DELETE ON "shift_incident_steps"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the trigger).
REVOKE ALL ON "shift_incident_steps" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "shift_incident_steps" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_incident_steps" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "shift_incident_steps" TO impera_service;
