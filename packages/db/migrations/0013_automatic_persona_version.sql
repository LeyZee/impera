-- Automatique is proved on the persona too (ADR 0022): a blind test records the persona active when it was taken,
-- null without one. Older tests keep null, so they only count while no persona is active. No data is removed.
DROP INDEX "blind_tests_version_idx";--> statement-breakpoint
ALTER TABLE "blind_tests" ADD COLUMN "persona_version_id" uuid;--> statement-breakpoint
ALTER TABLE "blind_tests" ADD CONSTRAINT "blind_tests_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blind_tests_version_idx" ON "blind_tests" USING btree ("creator_id","voice_prompt","voice_model","persona_version_id","recorded_at" DESC NULLS LAST);