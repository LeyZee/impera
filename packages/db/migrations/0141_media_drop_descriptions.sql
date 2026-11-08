-- ADR 0083, ADR 0030 § 3: each photo and video she drops is described by the vision AI on arrival, once per media and
-- describer (the unique index on the AI's rows: a replayed job writes nothing twice). A correction is a new human row;
-- validation names the member and the time on the row it validates, both or neither; review_reasons is what the code
-- read in the AI's answer (a pointer to another media, another person, a doubt, a flag). No new table, no new policy:
-- the table keeps its tenant policy and stays read-only to her.
ALTER TABLE "media_descriptions" ADD COLUMN "author" text DEFAULT 'sense' NOT NULL;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "validated_by" uuid;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "creator_note" text;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD COLUMN "review_reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_validated_by_team_members_id_fk" FOREIGN KEY ("validated_by") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "media_descriptions_sense_unique" ON "media_descriptions" USING btree ("media_asset_id","prompt_hash") WHERE "media_descriptions"."author" = 'sense';--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_author_check" CHECK ("media_descriptions"."author" in ('sense', 'human'));--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_review_reasons_check" CHECK ("media_descriptions"."review_reasons" <@ array['back_reference', 'not_alone', 'unsure', 'flagged']::text[]);--> statement-breakpoint
ALTER TABLE "media_descriptions" ADD CONSTRAINT "media_descriptions_validated_check" CHECK (("media_descriptions"."validated_by" is null) = ("media_descriptions"."validated_at" is null));