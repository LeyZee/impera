-- ADR 0117 § 3 (migration 0221, numéro provisoire): the canvas lines of a fan's client note the agent wrote last, one
-- row per account, fan and line. Never the line: its keyed mark (`<key version>:<HMAC-SHA-256>`, key derived from the
-- session keys and the account id, never stored), to know whether a human changed it since. Written by the connector
-- inside the creator's tenant (withTenant): nirvana_app selects, inserts and updates, never deletes; closed to her own
-- account.
CREATE TABLE "connector_note_lines" (
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"platform_fan_id" text NOT NULL,
	"slot" text NOT NULL,
	"line_hash" text NOT NULL,
	"owner" text NOT NULL,
	"corrected" boolean DEFAULT false NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "connector_note_lines_pk" PRIMARY KEY("platform_account_id","platform_fan_id","slot"),
	CONSTRAINT "connector_note_lines_owner_check" CHECK ("connector_note_lines"."owner" in ('agent', 'human')),
	CONSTRAINT "connector_note_lines_hash_check" CHECK ("connector_note_lines"."line_hash" ~ '^[a-z0-9]{1,16}:[0-9a-f]{64}$'),
	CONSTRAINT "connector_note_lines_slot_check" CHECK ("connector_note_lines"."slot" in ('first_name', 'location', 'age', 'job', 'hobbies', 'desires', 'situation'))
);
--> statement-breakpoint
ALTER TABLE "connector_note_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_note_lines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "connector_note_lines" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "connector_note_lines" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "connector_note_lines" TO impera_service;--> statement-breakpoint
ALTER TABLE "connector_note_lines" ADD CONSTRAINT "connector_note_lines_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_note_lines" ADD CONSTRAINT "connector_note_lines_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "connector_note_lines_creator_idx" ON "connector_note_lines" USING btree ("creator_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "connector_note_lines" AS PERMISSIVE FOR ALL TO public USING ("connector_note_lines"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("connector_note_lines"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "connector_note_lines" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');