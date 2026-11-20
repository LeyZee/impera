-- ADR 0154: her bio on her platform profile, as last read, given to the agent beside her persona. Read only from the
-- platform; written by the poll inside her tenant (nirvana_app already has DML on platform_accounts). Public text: no
-- new restriction for her own account, which reads platform_accounts.
ALTER TABLE "platform_accounts" ADD COLUMN "profile_bio" text;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD COLUMN "profile_bio_read_at" timestamp with time zone;
