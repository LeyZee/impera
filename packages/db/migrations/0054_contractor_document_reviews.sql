-- EQ-06 lot 5c, Charles's choice (a) of 01/11 (no invoice under a tax treaty without the tax residence certificate,
-- never the 25 % withholding of art. 182 B) and his « ok vérif pièce » of 01/11 (the owner checks each document).
-- `contractor_document_reviews`: the owner's check of a document, accepted or refused with its reason, once per
-- document and added only, like the documents themselves (0041): a refused file stays refused, the contractor files a
-- new one. The owner checks for a contractor, never a document of his own member record (`owner_insert`, the same
-- clause as the other writes « for » a contractor). The contractor reads the checks of his own documents, the owner
-- and an active manager every one. An acceptance keeps the end of the lock the bucket was asked to hold on the file
-- (`retain_until`, that of the invoices it may cover); a refusal has none: its file keeps its upload lock only.
-- `contractor_documents.retain_until`: the end of the lock posed on the file at its upload (thirty days, until the
-- owner's check), as `invoice_pdfs.retain_until` (0045). NOT NULL with no default: no route nor job wrote this table
-- before this lot, so no row exists anywhere.
CREATE TABLE "contractor_document_reviews" (
	"document_id" uuid PRIMARY KEY NOT NULL,
	"decision" text NOT NULL,
	"reason" text,
	"reviewed_by" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"retain_until" timestamp with time zone,
	CONSTRAINT "contractor_document_reviews_decision_check" CHECK ("contractor_document_reviews"."decision" in ('accepted', 'refused')),
	CONSTRAINT "contractor_document_reviews_reason_check" CHECK (("contractor_document_reviews"."decision" = 'refused') = ("contractor_document_reviews"."reason" is not null) and ("contractor_document_reviews"."reason" is null or char_length("contractor_document_reviews"."reason") between 1 and 500)),
	CONSTRAINT "contractor_document_reviews_retain_check" CHECK (("contractor_document_reviews"."decision" = 'accepted') = ("contractor_document_reviews"."retain_until" is not null))
);
--> statement-breakpoint
ALTER TABLE "contractor_document_reviews" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contractor_documents" ADD COLUMN "retain_until" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "contractor_document_reviews" ADD CONSTRAINT "contractor_document_reviews_document_id_contractor_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."contractor_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contractor_document_reviews" ADD CONSTRAINT "contractor_document_reviews_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "member_read" ON "contractor_document_reviews" AS PERMISSIVE FOR SELECT TO public USING (nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') or exists (select 1 from team_members m where m.id = (select d.member_id from contractor_documents d where d.id = "contractor_document_reviews"."document_id") and m.user_id = nullif(current_setting('app.user_id', true), '')));--> statement-breakpoint
CREATE POLICY "owner_insert" ON "contractor_document_reviews" AS PERMISSIVE FOR INSERT TO public WITH CHECK (nullif(current_setting('app.team_scope', true), '') = 'owner' and not exists (select 1 from team_members m where m.id = (select d.member_id from contractor_documents d where d.id = "contractor_document_reviews"."document_id") and m.user_id = nullif(current_setting('app.user_id', true), '')) and "contractor_document_reviews"."reviewed_by" = nullif(current_setting('app.user_id', true), ''));--> statement-breakpoint
ALTER TABLE "contractor_document_reviews" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TRIGGER "contractor_document_reviews_append_only" BEFORE UPDATE OR DELETE ON "contractor_document_reviews"
  FOR EACH ROW EXECUTE FUNCTION "refuse_billing_change"();--> statement-breakpoint
-- From nothing, whatever the default privileges of the base gave (a TRUNCATE would pass the RLS and the triggers).
REVOKE ALL ON "contractor_document_reviews" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "contractor_document_reviews" TO nirvana_app;
