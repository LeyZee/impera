-- Export now, out of the nightly hour (REG-24, accepted by Charles on 29/10). Additive. The owner asks through the
-- API, the `backup` service (admin role) picks the request up and runs the same export as each night; the
-- application never runs it (ADR 0028 § 1). Out of RLS: no tenant data.
CREATE TABLE "backup_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"picked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "backup_requests" ADD CONSTRAINT "backup_requests_requested_by_user_id_user_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backup_requests_pending_idx" ON "backup_requests" USING btree ("requested_at") WHERE "backup_requests"."picked_at" is null;--> statement-breakpoint
-- Added by hand after `drizzle-kit generate`, as for backup_runs (0019): the application asks and reads, never marks
-- a request picked nor deletes one; the `backup` service does that with the admin role.
REVOKE ALL ON "backup_requests" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "backup_requests" TO nirvana_app;
