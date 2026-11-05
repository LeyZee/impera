-- CRM-07 lot a1 (ADR 0069). The owner's import review of the platform's models: a model set aside from it is kept in
-- `sales_feed_model_dismissals` (one row per model, deleted when taken back), agency-level and closed to a creator's
-- own account; the row is never updated, so the application role gets no UPDATE on it. A creator's photo copied into
-- the media storage is kept by its key there (`creators.avatar_key`, lot a2), never by the platform's address.
CREATE TABLE "sales_feed_model_dismissals" (
	"platform" text NOT NULL,
	"platform_model_id" text NOT NULL,
	"dismissed_by" text,
	"dismissed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_feed_model_dismissals_pk" PRIMARY KEY("platform","platform_model_id"),
	CONSTRAINT "sales_feed_model_dismissals_platform_check" CHECK ("sales_feed_model_dismissals"."platform" in ('reveal', 'onlyfans', 'instagram', 'impera')),
	CONSTRAINT "sales_feed_model_dismissals_id_check" CHECK (char_length("sales_feed_model_dismissals"."platform_model_id") between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "sales_feed_model_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_avatar_key_check" CHECK ("creators"."avatar_key" is null or char_length("creators"."avatar_key") between 1 and 200);--> statement-breakpoint
CREATE POLICY "agency_only" ON "sales_feed_model_dismissals" AS PERMISSIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
ALTER TABLE "sales_feed_model_dismissals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "sales_feed_model_dismissals" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "sales_feed_model_dismissals" TO nirvana_app;
