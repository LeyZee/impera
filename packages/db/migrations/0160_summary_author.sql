-- SC-04 lot c5, ADR 0030 § 3 and ADR 0083 § 7: her team corrects a script's synthesis by hand. A new row
-- (`author = 'human'`), validated by the one who writes it (`team_correct`), never an update: the table stays written
-- once, validated once. The brain keeps one telling per media and prompt; a hand corrects as often as it likes.
DROP INDEX "script_drop_summaries_unique";--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD COLUMN "author" text DEFAULT 'brain' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "script_drop_summaries_unique" ON "script_drop_summaries" USING btree ("drop_id","media_hash","prompt_hash") WHERE "script_drop_summaries"."author" = 'brain';--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD CONSTRAINT "script_drop_summaries_author_check" CHECK ("script_drop_summaries"."author" in ('brain', 'human'));--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD CONSTRAINT "script_drop_summaries_human_check" CHECK ("script_drop_summaries"."author" <> 'human' or ("script_drop_summaries"."validated_at" is not null and "script_drop_summaries"."review_reasons" = '{}'::text[]));--> statement-breakpoint
CREATE POLICY "team_correct" ON "script_drop_summaries" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "script_drop_summaries"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "script_drop_summaries"."author" = 'human' and "script_drop_summaries"."validated_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
GRANT INSERT ON "script_drop_summaries" TO nirvana_app;
