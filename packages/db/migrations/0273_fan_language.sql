-- ADR 0168 § 3: his kept language, a value of LANGUAGES, read by code or set by a person (whom code never overwrites).
-- Nullable, nothing backfilled: his next message sets it. The row policies of "fans" are row-level and apply to these
-- columns as they are: "tenant_isolation" (her creator only) and the restrictive "creator_no_insert", "creator_no_update"
-- and "creator_no_delete" (a creator account never writes a fan). The column grants below say explicitly that the
-- application role reads and writes them. The service role keeps the read of every table it has had since 0191 (it is
-- not bound by row policies, ADR 0087) and writes none of these columns.
ALTER TABLE "fans" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "fans" ADD COLUMN "language_source" text;--> statement-breakpoint
ALTER TABLE "fans" ADD COLUMN "language_set_by" text;--> statement-breakpoint
ALTER TABLE "fans" ADD COLUMN "language_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fans" ADD CONSTRAINT "fans_language_set_by_user_id_fk" FOREIGN KEY ("language_set_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fans" ADD CONSTRAINT "fans_language_check" CHECK ("fans"."language" in ('french', 'english', 'italian', 'spanish', 'german', 'portuguese', 'dutch', 'arabic'));--> statement-breakpoint
ALTER TABLE "fans" ADD CONSTRAINT "fans_language_source_check" CHECK ("fans"."language_source" in ('detected', 'set'));--> statement-breakpoint
ALTER TABLE "fans" ADD CONSTRAINT "fans_language_whole_check" CHECK (("fans"."language" is null and "fans"."language_source" is null and "fans"."language_set_at" is null and "fans"."language_set_by" is null) or ("fans"."language" is not null and "fans"."language_source" is not null and "fans"."language_set_at" is not null and ("fans"."language_source" = 'set') = ("fans"."language_set_by" is not null)));--> statement-breakpoint
GRANT SELECT ("language", "language_source", "language_set_by", "language_set_at") ON "fans" TO nirvana_app;--> statement-breakpoint
GRANT UPDATE ("language", "language_source", "language_set_by", "language_set_at") ON "fans" TO nirvana_app;
