-- Whose session an account holds, as the platform names her (on Reveal, the model id), written at each « Sync » beside
-- the ciphertext. One platform identity belongs to one account, whatever the creator: the constraint answers where the
-- application has nothing stored to compare with (a first « Sync »), and for two « Sync » at once. Accounts synced
-- before this migration get theirs at their next « Sync ».
ALTER TABLE "platform_accounts" ADD COLUMN "session_owner" text;--> statement-breakpoint
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_platform_session_owner_unique" UNIQUE("platform","session_owner");