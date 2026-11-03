-- The mini feedback (ADR 0050 § 10): what a chatter adds at the end of a shift on an account whose pay reads the
-- platform's sales, instead of a report. No amount, no review, never read by pay; one per shift, never rewritten.
CREATE TABLE "shift_feedbacks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"period" date NOT NULL,
	"nothing_to_report" boolean NOT NULL,
	"comment" text,
	"incident" text,
	"signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_feedbacks_period_check" CHECK (extract(day from "shift_feedbacks"."period") in (1, 16)),
	CONSTRAINT "shift_feedbacks_texts_check" CHECK (coalesce(char_length("shift_feedbacks"."comment"), 1) between 1 and 1000 and coalesce(char_length("shift_feedbacks"."incident"), 1) between 1 and 1000),
	CONSTRAINT "shift_feedbacks_signals_check" CHECK (jsonb_typeof("shift_feedbacks"."signals") = 'array' and jsonb_array_length("shift_feedbacks"."signals") <= 5),
	CONSTRAINT "shift_feedbacks_said_check" CHECK ("shift_feedbacks"."nothing_to_report" = ("shift_feedbacks"."comment" is null and "shift_feedbacks"."incident" is null and jsonb_array_length("shift_feedbacks"."signals") = 0))
);
--> statement-breakpoint
ALTER TABLE "shift_feedbacks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shift_feedbacks" ADD CONSTRAINT "shift_feedbacks_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_feedbacks" ADD CONSTRAINT "shift_feedbacks_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_feedbacks" ADD CONSTRAINT "shift_feedbacks_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_feedbacks" ADD CONSTRAINT "shift_feedbacks_shift_fk" FOREIGN KEY ("shift_id","creator_id","platform_account_id","member_id") REFERENCES "public"."shifts"("id","creator_id","platform_account_id","member_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shift_feedbacks_shift_unique" ON "shift_feedbacks" USING btree ("shift_id");--> statement-breakpoint
CREATE INDEX "shift_feedbacks_member_period_idx" ON "shift_feedbacks" USING btree ("member_id","period");--> statement-breakpoint
CREATE POLICY "member_read" ON "shift_feedbacks" AS PERMISSIVE FOR SELECT TO public USING ("shift_feedbacks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = "shift_feedbacks"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), ''))));--> statement-breakpoint
CREATE POLICY "member_insert" ON "shift_feedbacks" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("shift_feedbacks"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and exists (select 1 from team_members m where m.id = "shift_feedbacks"."member_id" and m.user_id = nullif(current_setting('app.user_id', true), '')) and "shift_feedbacks"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpointALTER TABLE "shift_feedbacks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "shift_feedbacks_append_only" BEFORE UPDATE OR DELETE ON "shift_feedbacks"
  FOR EACH ROW EXECUTE FUNCTION "refuse_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the trigger).
REVOKE ALL ON "shift_feedbacks" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "shift_feedbacks" TO nirvana_app;
