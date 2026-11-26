-- « Écrire à l'agence » (Charles, 21/11, trous béants n° 13): additive. `creator_messages`, what a creator writes to
-- the agency and the owner's answer. Written by her alone, read by her owner and an active manager, answered once by
-- the owner, never deleted.
CREATE TABLE "creator_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answer" text,
	"answered_by" text,
	"answered_at" timestamp with time zone,
	CONSTRAINT "creator_messages_kind_check" CHECK ("creator_messages"."kind" in ('question', 'idea', 'worry')),
	CONSTRAINT "creator_messages_body_check" CHECK (char_length("creator_messages"."body") between 1 and 1000),
	CONSTRAINT "creator_messages_answer_check" CHECK (char_length("creator_messages"."answer") between 1 and 1000),
	CONSTRAINT "creator_messages_answered_check" CHECK (("creator_messages"."answer" is null) = ("creator_messages"."answered_by" is null) and ("creator_messages"."answer" is null) = ("creator_messages"."answered_at" is null))
);
--> statement-breakpoint
ALTER TABLE "creator_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creator_messages" ADD CONSTRAINT "creator_messages_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_messages" ADD CONSTRAINT "creator_messages_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_messages" ADD CONSTRAINT "creator_messages_answered_by_user_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_messages_creator_created_idx" ON "creator_messages" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE POLICY "creator_read" ON "creator_messages" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "creator_messages"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "creator_messages" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "creator_messages"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_messages"."created_by" = nullif(current_setting('app.user_id', true), '') and "creator_messages"."answer" is null);--> statement-breakpoint
CREATE POLICY "team_read" ON "creator_messages" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and "creator_messages"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and (nullif(current_setting('app.team_scope', true), '') = 'owner' or (nullif(current_setting('app.team_scope', true), '') = 'agency' and exists (select 1 from "user" u where u.id = nullif(current_setting('app.user_id', true), '') and "creator_messages"."creator_id" = any(u.creator_ids)))));--> statement-breakpoint
CREATE POLICY "owner_answer" ON "creator_messages" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_messages"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_messages"."answer" is null) WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') = 'owner' and "creator_messages"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "creator_messages"."answered_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "creator_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave.
REVOKE ALL ON "creator_messages" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "creator_messages" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "creator_messages" TO nirvana_app;--> statement-breakpoint
-- The answer only: her words, her kind and her day never change.
GRANT UPDATE ("answer", "answered_by", "answered_at") ON "creator_messages" TO nirvana_app;--> statement-breakpoint
GRANT SELECT ON "creator_messages" TO impera_service;
