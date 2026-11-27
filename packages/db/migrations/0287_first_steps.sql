ALTER TABLE "user" ADD COLUMN "backup_codes_kept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "welcomed_at" timestamp with time zone;--> statement-breakpoint
-- The accounts already active went through both steps before these columns existed: nothing is asked of them again.
UPDATE "user" SET "backup_codes_kept_at" = now(), "welcomed_at" = now() WHERE "two_factor_enabled";
