-- What she tells the agency herself (Charles, 21/11): her absences and what she no longer does. Additive. Written by
-- her alone in her own account, read by whoever the server opened her creator to, never deleted: she takes one back,
-- the row stays, marked.
CREATE TABLE "creator_absences" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" text,
	CONSTRAINT "creator_absences_days_check" CHECK ("creator_absences"."starts_on" <= "creator_absences"."ends_on"),
	CONSTRAINT "creator_absences_span_check" CHECK ("creator_absences"."ends_on" - "creator_absences"."starts_on" < 60),
	CONSTRAINT "creator_absences_note_check" CHECK (char_length("creator_absences"."note") <= 200),
	CONSTRAINT "creator_absences_cancel_check" CHECK (("creator_absences"."cancelled_at" is null) = ("creator_absences"."cancelled_by" is null))
);
--> statement-breakpoint
ALTER TABLE "creator_absences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "creator_stops" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"what" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"withdrawn_by" text,
	CONSTRAINT "creator_stops_what_check" CHECK (char_length("creator_stops"."what") between 1 and 200),
	CONSTRAINT "creator_stops_withdraw_check" CHECK (("creator_stops"."withdrawn_at" is null) = ("creator_stops"."withdrawn_by" is null))
);
--> statement-breakpoint
ALTER TABLE "creator_stops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_absences" ADD CONSTRAINT "creator_absences_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_absences" ADD CONSTRAINT "creator_absences_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_absences" ADD CONSTRAINT "creator_absences_cancelled_by_user_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_stops" ADD CONSTRAINT "creator_stops_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_stops" ADD CONSTRAINT "creator_stops_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_stops" ADD CONSTRAINT "creator_stops_withdrawn_by_user_id_fk" FOREIGN KEY ("withdrawn_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_absences_creator_ends_idx" ON "creator_absences" USING btree ("creator_id","ends_on");--> statement-breakpoint
CREATE INDEX "creator_stops_creator_idx" ON "creator_stops" USING btree ("creator_id");--> statement-breakpoint
CREATE POLICY "tenant_read" ON "creator_absences" AS PERMISSIVE FOR SELECT TO public USING ("creator_absences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "creator_absences" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_absences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_absences"."created_by" = nullif(current_setting('app.user_id', true), '') and "creator_absences"."cancelled_at" is null);--> statement-breakpoint
CREATE POLICY "creator_update" ON "creator_absences" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_absences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_absences"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_absences"."cancelled_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "tenant_read" ON "creator_stops" AS PERMISSIVE FOR SELECT TO public USING ("creator_stops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "creator_stops" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_stops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_stops"."created_by" = nullif(current_setting('app.user_id', true), '') and "creator_stops"."withdrawn_at" is null);--> statement-breakpoint
CREATE POLICY "creator_update" ON "creator_stops" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_stops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_stops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_stops"."withdrawn_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "creator_absences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_stops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave.
REVOKE ALL ON "creator_absences" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "creator_absences" FROM impera_service;--> statement-breakpoint
REVOKE ALL ON "creator_stops" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "creator_stops" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_absences" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_stops" TO nirvana_app;--> statement-breakpoint
-- Taking one back only: what she wrote never changes.
GRANT UPDATE ("cancelled_at", "cancelled_by") ON "creator_absences" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("withdrawn_at", "withdrawn_by") ON "creator_stops" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_absences" TO impera_service;--> statement-breakpoint
GRANT SELECT ON "creator_stops" TO impera_service;
