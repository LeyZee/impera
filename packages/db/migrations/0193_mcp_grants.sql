-- MCP lot a (migration 0193, ADR 0026 § 3, ADR 0105): the agent accesses. Read, added, stamped and revoked by the owner
-- inside withMember, never deleted; read only by the service role, to find the access of a token (ADR 0087).
CREATE TABLE "mcp_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"creator_id" uuid,
	"label" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"token_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	CONSTRAINT "mcp_grants_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "mcp_grants_label_check" CHECK (char_length("mcp_grants"."label") between 1 and 40),
	CONSTRAINT "mcp_grants_capabilities_check" CHECK ("mcp_grants"."capabilities" <@ array['read:status', 'read:conversations', 'read:conversation_content', 'read:fans', 'read:team', 'read:payroll', 'read:sales', 'read:media', 'read:script_content', 'write:drafts', 'write:brakes', 'write:tasks', 'write:drops', 'prepare:team']::text[] and array_position("mcp_grants"."capabilities", null) is null),
	CONSTRAINT "mcp_grants_token_hash_check" CHECK ("mcp_grants"."token_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "mcp_grants_expires_check" CHECK ("mcp_grants"."expires_at" > "mcp_grants"."created_at" and "mcp_grants"."expires_at" <= "mcp_grants"."created_at" + interval '90 days'),
	CONSTRAINT "mcp_grants_revoked_check" CHECK (("mcp_grants"."revoked_at" is null) = ("mcp_grants"."revoked_by" is null) and ("mcp_grants"."revoked_at" is null or "mcp_grants"."revoked_at" >= "mcp_grants"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "mcp_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_revoked_by_user_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_grants_user_idx" ON "mcp_grants" USING btree ("user_id");--> statement-breakpoint
CREATE POLICY "owner_read" ON "mcp_grants" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "owner_insert" ON "mcp_grants" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and "mcp_grants"."user_id" = nullif(current_setting('app.user_id', true), '') and "mcp_grants"."created_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
CREATE POLICY "owner_update" ON "mcp_grants" AS PERMISSIVE FOR UPDATE TO public USING (nullif(current_setting('app.team_scope', true), '') = 'owner') WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "mcp_grants" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');
--> statement-breakpoint
-- Written by hand. Drizzle does not write what follows.
ALTER TABLE "mcp_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app adds a row and changes only its last use and its
-- revocation; nobody deletes one (a TRUNCATE would pass the RLS).
REVOKE ALL ON "mcp_grants" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "mcp_grants" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("last_used_at", "revoked_at", "revoked_by") ON "mcp_grants" TO nirvana_app;--> statement-breakpoint
-- ADR 0087: the service role reads it (the token's access, out of any person), and writes nothing.
GRANT SELECT ON "mcp_grants" TO impera_service;--> statement-breakpoint
-- A revocation is for good, and a last use only moves forward: an access is never brought back, a renewal is a new one.
CREATE FUNCTION "refuse_mcp_grant_change"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."revoked_at" IS NOT NULL AND (NEW."revoked_at" IS DISTINCT FROM OLD."revoked_at" OR NEW."revoked_by" IS DISTINCT FROM OLD."revoked_by") THEN
    RAISE EXCEPTION 'this change to mcp_grants is refused: a revoked access stays revoked'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."last_used_at" < OLD."last_used_at" THEN
    RAISE EXCEPTION 'this change to mcp_grants is refused: a last use only moves forward'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "mcp_grants_guarded" BEFORE UPDATE ON "mcp_grants"
  FOR EACH ROW EXECUTE FUNCTION "refuse_mcp_grant_change"();
