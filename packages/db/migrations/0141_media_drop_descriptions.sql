-- ADR 0083, ADR 0030 § 3: each photo and video she drops is described by the vision AI on arrival, once per media and
-- describer (the unique index on the AI's rows: a replayed job writes nothing twice). A correction is a new human row;
-- review_reasons is what the code read in the AI's answer (a pointer to another media, another person, a doubt, a
-- flag). Who validates a row and when come with the validation screen (SC-04 lot c). No new table, no new policy: the
-- table keeps its tenant policy and stays read-only to her.
ALTER TABLE "media_descriptions" ADD COLUMN "author" text DEFAULT 'sense' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "creator_note" text;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "review_reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "media_descriptions_drop_unique" ON "media_descriptions" USING btree ("media_asset_id","prompt_hash") WHERE "media_descriptions"."author" = 'sense' and "media_descriptions"."content" ? 'detailed';--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_author_check" CHECK ("media_descriptions"."author" in ('sense', 'human'));--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_review_reasons_check" CHECK ("media_descriptions"."review_reasons" <@ array['back_reference', 'not_alone', 'unsure', 'flagged']::text[]);