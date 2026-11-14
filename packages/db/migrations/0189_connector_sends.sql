-- P2-03 (migration 0189, reveal-connector-spec.md § 5): the connector's own sends. Reveal takes no nonce, so each attempt is recorded
-- here before the call (unique idempotency key per account, the conversation, the SHA-256 fingerprint of the text, the
-- script step and the media, when the attempt started) and gets Reveal's message id once known. A retry of a key still
-- `pending` asks Reveal (`verifySent`) before any new send. Written by the connector inside the creator's tenant
-- (withTenant): nirvana_app selects, inserts and updates, never deletes; closed to her own account.
CREATE TABLE "connector_sends" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"platform_account_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"platform_conversation_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"script_ref" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempt_started_at" timestamp with time zone NOT NULL,
	"platform_message_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "connector_sends_key_unique" UNIQUE("platform_account_id","idempotency_key"),
	CONSTRAINT "connector_sends_state_check" CHECK ("connector_sends"."state" in ('pending', 'sent')),
	CONSTRAINT "connector_sends_fingerprint_check" CHECK ("connector_sends"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "connector_sends_sent_check" CHECK (("connector_sends"."state" = 'sent') = ("connector_sends"."platform_message_id" is not null) and ("connector_sends"."platform_message_id" is null) = ("connector_sends"."sent_at" is null))
);
--> statement-breakpoint
ALTER TABLE "connector_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_sends" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "connector_sends" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "connector_sends" TO nirvana_app;--> statement-breakpoint
ALTER TABLE "connector_sends" ADD CONSTRAINT "connector_sends_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connector_sends" ADD CONSTRAINT "connector_sends_account_creator_fk" FOREIGN KEY ("platform_account_id","creator_id") REFERENCES "public"."platform_accounts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "connector_sends_message_unique" ON "connector_sends" USING btree ("platform_account_id","platform_message_id") WHERE "connector_sends"."platform_message_id" is not null;--> statement-breakpoint
CREATE INDEX "connector_sends_conversation_idx" ON "connector_sends" USING btree ("platform_account_id","platform_conversation_id");--> statement-breakpoint
CREATE INDEX "connector_sends_creator_idx" ON "connector_sends" USING btree ("creator_id");--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "connector_sends" AS PERMISSIVE FOR ALL TO public USING ("connector_sends"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid) WITH CHECK ("connector_sends"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "connector_sends" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');
