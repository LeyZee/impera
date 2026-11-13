-- ADR 0103 (the playground kept in the database) and ADR 0102 (her bank of voice examples). The agency's training rows:
-- each table is a creator's (FORCE RLS, tenant_isolation) and closed to her own account (creator_closed). The owner
-- plays, rates, marks and replays inside withTenant: nirvana_app reads and writes them, deletes a conversation or a mark
-- of his, and only retires a case (its runs stay). calibration_ratings keeps its grants; it gains the persona version
-- that answered (the rate per version, ADR 0103 § 5) and the state of a correction in her bank (ADR 0102).
CREATE TABLE "desire_marks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"conversation_id" uuid,
	"fan_message_number" integer NOT NULL,
	"fan_message" text NOT NULL,
	"verdict" text NOT NULL,
	"note" text,
	"reading" jsonb NOT NULL,
	"weights_version" text NOT NULL,
	"marked_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "desire_marks_verdict_check" CHECK ("desire_marks"."verdict" in ('too_high', 'too_low', 'right')),
	CONSTRAINT "desire_marks_number_check" CHECK ("desire_marks"."fan_message_number" >= 1),
	CONSTRAINT "desire_marks_note_check" CHECK ("desire_marks"."note" is null or char_length("desire_marks"."note") between 1 and 500),
	CONSTRAINT "desire_marks_reading_check" CHECK (jsonb_typeof("desire_marks"."reading") = 'object')
);
--> statement-breakpoint
ALTER TABLE "desire_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "desire_marks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "desire_marks" TO nirvana_app;--> statement-breakpoint
REVOKE UPDATE ON "desire_marks" FROM nirvana_app;--> statement-breakpoint
CREATE TABLE "playground_case_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"persona_version_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"bubbles" jsonb NOT NULL,
	"judge_passed" boolean,
	"judge_note" text,
	"owner_passed" boolean,
	"cost_usd" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "playground_case_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playground_case_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "playground_case_runs" TO nirvana_app;--> statement-breakpoint
REVOKE DELETE ON "playground_case_runs" FROM nirvana_app;--> statement-breakpoint
CREATE TABLE "playground_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"persona_version_id" uuid NOT NULL,
	"rating_id" uuid,
	"moment" jsonb NOT NULL,
	"fan_message" text NOT NULL,
	"missed_bubbles" jsonb NOT NULL,
	"expectation" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retired_at" timestamp with time zone,
	CONSTRAINT "playground_cases_moment_check" CHECK (jsonb_typeof("playground_cases"."moment") = 'object'),
	CONSTRAINT "playground_cases_expectation_check" CHECK (char_length("playground_cases"."expectation") between 1 and 500)
);
--> statement-breakpoint
ALTER TABLE "playground_cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playground_cases" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "playground_cases" TO nirvana_app;--> statement-breakpoint
REVOKE DELETE ON "playground_cases" FROM nirvana_app;--> statement-breakpoint
CREATE TABLE "playground_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"persona_version_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"state" jsonb NOT NULL,
	"fan_messages" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "playground_conversations_state_check" CHECK (jsonb_typeof("playground_conversations"."state") = 'object'),
	CONSTRAINT "playground_conversations_fan_messages_check" CHECK ("playground_conversations"."fan_messages" >= 0)
);
--> statement-breakpoint
ALTER TABLE "playground_conversations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "playground_conversations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "playground_conversations" TO nirvana_app;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD COLUMN "persona_version_id" uuid;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD COLUMN "example_state" text;--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD COLUMN "example_state_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "desire_marks" ADD CONSTRAINT "desire_marks_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_marks" ADD CONSTRAINT "desire_marks_conversation_id_playground_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."playground_conversations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desire_marks" ADD CONSTRAINT "desire_marks_marked_by_user_id_fk" FOREIGN KEY ("marked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_case_runs" ADD CONSTRAINT "playground_case_runs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_case_runs" ADD CONSTRAINT "playground_case_runs_case_id_playground_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."playground_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_case_runs" ADD CONSTRAINT "playground_case_runs_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_cases" ADD CONSTRAINT "playground_cases_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_cases" ADD CONSTRAINT "playground_cases_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_cases" ADD CONSTRAINT "playground_cases_rating_id_calibration_ratings_id_fk" FOREIGN KEY ("rating_id") REFERENCES "public"."calibration_ratings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_cases" ADD CONSTRAINT "playground_cases_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_conversations" ADD CONSTRAINT "playground_conversations_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_conversations" ADD CONSTRAINT "playground_conversations_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playground_conversations" ADD CONSTRAINT "playground_conversations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "desire_marks_creator_idx" ON "desire_marks" USING btree ("creator_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "playground_case_runs_case_idx" ON "playground_case_runs" USING btree ("creator_id","case_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "playground_case_runs_batch_idx" ON "playground_case_runs" USING btree ("creator_id","batch_id");--> statement-breakpoint
CREATE INDEX "playground_cases_creator_idx" ON "playground_cases" USING btree ("creator_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "playground_conversations_user_idx" ON "playground_conversations" USING btree ("creator_id","user_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD CONSTRAINT "calibration_ratings_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calibration_ratings_persona_version_idx" ON "calibration_ratings" USING btree ("creator_id","persona_version_id","rated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calibration_ratings_examples_idx" ON "calibration_ratings" USING btree ("creator_id","rated_at" DESC NULLS LAST) WHERE "calibration_ratings"."example_state" = 'active';--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD CONSTRAINT "calibration_ratings_example_state_check" CHECK ("calibration_ratings"."example_state" in ('active', 'withdrawn', 'blocked'));--> statement-breakpoint
ALTER TABLE "calibration_ratings" ADD CONSTRAINT "calibration_ratings_example_shape_check" CHECK (("calibration_ratings"."example_state" is null and "calibration_ratings"."example_state_at" is null)
        or ("calibration_ratings"."example_state" is not null and "calibration_ratings"."example_state_at" is not null and "calibration_ratings"."verdict_kind" = 'corrected' and "calibration_ratings"."destination" = 'voice_example'));--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "desire_marks" AS PERMISSIVE FOR ALL TO public USING ("desire_marks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("desire_marks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "desire_marks" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "playground_case_runs" AS PERMISSIVE FOR ALL TO public USING ("playground_case_runs"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("playground_case_runs"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "playground_case_runs" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "playground_cases" AS PERMISSIVE FOR ALL TO public USING ("playground_cases"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("playground_cases"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "playground_cases" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "playground_conversations" AS PERMISSIVE FOR ALL TO public USING ("playground_conversations"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("playground_conversations"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "playground_conversations" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');