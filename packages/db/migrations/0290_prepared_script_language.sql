-- A script carries the language of its texts, and a version in another language is linked to its source, of the same
-- creator, one per language (langue du fan, ADR 0169).
ALTER TABLE "prepared_scripts" ADD COLUMN "language" text DEFAULT 'french' NOT NULL;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD COLUMN "version_of" uuid;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_id_creator_unique" UNIQUE("id","creator_id");--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_version_creator_fk" FOREIGN KEY ("version_of","creator_id") REFERENCES "public"."prepared_scripts"("id","creator_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prepared_scripts_version_language_unique" ON "prepared_scripts" USING btree ("version_of","language") WHERE "prepared_scripts"."version_of" is not null;--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_version_self_check" CHECK ("prepared_scripts"."version_of" is distinct from "prepared_scripts"."id");--> statement-breakpoint
ALTER TABLE "prepared_scripts" ADD CONSTRAINT "prepared_scripts_language_check" CHECK ("prepared_scripts"."language" in ('french', 'english', 'italian', 'spanish', 'german', 'portuguese', 'dutch', 'arabic'));
