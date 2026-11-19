-- The sorts of notification a creator turns on or off herself in Moi › Notifications (ADR 0150 § 16 ter): one row per
-- account and sort, no row meaning on. Each account reads and writes only its own rows (own_rows); the agency and
-- the service role never read them.
CREATE TABLE "notification_kind_preferences" (
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"enabled" boolean NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_kind_preferences_user_id_kind_pk" PRIMARY KEY("user_id","kind"),
	CONSTRAINT "notification_kind_preferences_kind_check" CHECK ("notification_kind_preferences"."kind" in ('agency_request', 'week_to_validate', 'earnings', 'lives'))
);
--> statement-breakpoint
ALTER TABLE "notification_kind_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_kind_preferences" ADD CONSTRAINT "notification_kind_preferences_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "own_rows" ON "notification_kind_preferences" AS PERMISSIVE FOR ALL TO public USING ("notification_kind_preferences"."user_id" = nullif(current_setting('app.user_id', true), '')) WITH CHECK ("notification_kind_preferences"."user_id" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "notification_kind_preferences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "notification_kind_preferences" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "notification_kind_preferences" TO nirvana_app;
