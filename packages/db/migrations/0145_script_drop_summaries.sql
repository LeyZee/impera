-- ADR 0083 § 6: a sent script told step by step and its synthesis, written by content_drops.summarize_script once each
-- of its media is described, once per set of media and per prompt. Only a job writes it (withAdmin); nirvana_app reads
-- it inside withTenantMember (the owner, or an active manager) and writes nothing.
CREATE TABLE "script_drop_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"drop_id" uuid NOT NULL,
	"media_hash" text NOT NULL,
	"content" jsonb NOT NULL,
	"review_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"model" text NOT NULL,
	"prompt_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "script_drop_summaries_review_reasons_check" CHECK ("script_drop_summaries"."review_reasons" <@ array['price']::text[]),
	CONSTRAINT "script_drop_summaries_media_hash_check" CHECK ("script_drop_summaries"."media_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "script_drop_summaries_content_check" CHECK (jsonb_typeof("script_drop_summaries"."content") = 'object')
);
--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "script_drop_summaries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
GRANT SELECT ON "script_drop_summaries" TO nirvana_app;--> statement-breakpoint
-- Where the default privileges of init.sql already gave the rest (the dev database): read only.
REVOKE INSERT, UPDATE, DELETE ON "script_drop_summaries" FROM nirvana_app;--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD CONSTRAINT "script_drop_summaries_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "script_drop_summaries" ADD CONSTRAINT "script_drop_summaries_drop_fk" FOREIGN KEY ("drop_id","creator_id") REFERENCES "public"."content_drops"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "script_drop_summaries_unique" ON "script_drop_summaries" USING btree ("drop_id","media_hash","prompt_hash");--> statement-breakpoint
CREATE INDEX "script_drop_summaries_creator_idx" ON "script_drop_summaries" USING btree ("creator_id");--> statement-breakpoint
CREATE POLICY "team_read" ON "script_drop_summaries" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "script_drop_summaries"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);