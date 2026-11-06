-- Her corrections of her persona sheet (recette CREA-01 b). Additive. `persona_corrections`: what she proposes from Moi >
-- Persona, one section and a few sentences; written and read by her own account, read by the owner and the active
-- managers, marked handled (`done`) by the owner alone, who alone changes her persona. Never deleted by the application.
CREATE TABLE "persona_corrections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"section" text NOT NULL,
	"text" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"done_by" text,
	"done_at" timestamp with time zone,
	CONSTRAINT "persona_corrections_section_check" CHECK ("persona_corrections"."section" in ('details', 'limits', 'lifestyle', 'tastes', 'intimate', 'writing_style')),
	CONSTRAINT "persona_corrections_state_check" CHECK ("persona_corrections"."state" in ('open', 'done')),
	CONSTRAINT "persona_corrections_text_check" CHECK (char_length("persona_corrections"."text") between 1 and 600),
	CONSTRAINT "persona_corrections_done_check" CHECK (("persona_corrections"."state" = 'done') = ("persona_corrections"."done_at" is not null and "persona_corrections"."done_by" is not null))
);
--> statement-breakpoint
ALTER TABLE "persona_corrections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "persona_corrections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "persona_corrections" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "persona_corrections" TO nirvana_app;--> statement-breakpoint
ALTER TABLE "persona_corrections" ADD CONSTRAINT "persona_corrections_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_corrections" ADD CONSTRAINT "persona_corrections_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_corrections" ADD CONSTRAINT "persona_corrections_done_by_user_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "persona_corrections_creator_idx" ON "persona_corrections" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE POLICY "creator_read" ON "persona_corrections" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "persona_corrections"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "creator_insert" ON "persona_corrections" AS PERMISSIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "persona_corrections"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "persona_corrections"."created_by" = nullif(current_setting('app.user_id', true), '') and "persona_corrections"."state" = 'open');--> statement-breakpoint
CREATE POLICY "team_read" ON "persona_corrections" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "persona_corrections"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "owner_update" ON "persona_corrections" AS PERMISSIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "persona_corrections"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "persona_corrections"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.team_scope', true), '') = 'owner' and "persona_corrections"."done_by" = nullif(current_setting('app.user_id', true), ''));