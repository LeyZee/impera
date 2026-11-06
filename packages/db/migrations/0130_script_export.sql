ALTER TABLE "content_drops" ADD COLUMN "exported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "content_drops" ADD COLUMN "exported_by" text;--> statement-breakpoint
ALTER TABLE "content_requests" ADD COLUMN "moment" text;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_exported_by_user_id_fk" FOREIGN KEY ("exported_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_exported_check" CHECK (("content_drops"."exported_at" is null) = ("content_drops"."exported_by" is null) and ("content_drops"."exported_at" is null or "content_drops"."script_number" is not null));--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_moment_check" CHECK ("content_requests"."moment" in ('day', 'night'));--> statement-breakpoint
ALTER TABLE "content_requests" ADD CONSTRAINT "content_requests_moment_version_check" CHECK ("content_requests"."moment" is null or "content_requests"."structure_version_id" is not null);--> statement-breakpoint
-- The team confirms the archive copied into Reveal (SC-03 c): these two columns, nothing more.
GRANT UPDATE ("exported_at", "exported_by") ON "content_drops" TO nirvana_app;
--> statement-breakpoint
-- Said once, by the team: her account never confirms an export, and a confirmation is never taken back nor moved.
CREATE FUNCTION "guard_content_drop_export"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."exported_at" IS DISTINCT FROM OLD."exported_at" OR NEW."exported_by" IS DISTINCT FROM OLD."exported_by" THEN
    IF OLD."exported_at" IS NOT NULL OR current_setting('app.account_role', true) = 'creator' THEN
      RAISE EXCEPTION 'an export is confirmed once, by the team (SC-03)' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "content_drops_export_guarded" BEFORE UPDATE ON "content_drops" FOR EACH ROW
  EXECUTE FUNCTION "guard_content_drop_export"();
