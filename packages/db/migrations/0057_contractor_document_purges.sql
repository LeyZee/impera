-- EQ-06 lot 5c-2, Charles's « ok purge a » of 01/11: a refused document's file is erased from the bucket once its
-- upload lock (30 days) has ended; its row and its check stay (dates, reason, fingerprint), only the bytes go.
-- `contractor_document_purges` says when, one row per document, added only like the documents and their checks. The
-- jobs alone write it (`payroll.purge_refused_documents`, admin connection): the application role reads it, never
-- inserts. `keep_contractor_document_purge`: a row only for a document the owner refused and whose upload lock has
-- ended, so that no code path ever records the erasure of a file an invoice may rely on. The contractor reads the
-- erasures of his own documents, the owner and an active manager every one (the clause of the checks, 0054).
CREATE TABLE "contractor_document_purges" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"purged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contractor_document_purges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_document_purges" ADD CONSTRAINT "contractor_document_purges_document_id_contractor_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."contractor_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "member_read" ON "contractor_document_purges" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = (select d.member_id from contractor_documents d where d.id = "contractor_document_purges"."document_id") and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
ALTER TABLE "contractor_document_purges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "contractor_document_purges_append_only" BEFORE UPDATE OR DELETE ON "contractor_document_purges"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "keep_contractor_document_purge"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM contractor_document_reviews r
    WHERE r.document_id = NEW.document_id AND r.decision = 'refused'
  ) THEN
    RAISE EXCEPTION 'only the file of a refused document is erased (EQ-06 lot 5c-2)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF EXISTS (
    SELECT 1 FROM contractor_documents d
    WHERE d.id = NEW.document_id AND d.retain_until > now()
  ) THEN
    RAISE EXCEPTION 'a document''s file is erased only once its upload lock has ended (EQ-06 lot 5c-2)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "contractor_document_purges_keep" BEFORE INSERT ON "contractor_document_purges"
  FOR EACH ROW EXECUTE FUNCTION "keep_contractor_document_purge"();--> statement-breakpoint
REVOKE ALL ON "contractor_document_purges" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "contractor_document_purges" TO nirvana_app;
