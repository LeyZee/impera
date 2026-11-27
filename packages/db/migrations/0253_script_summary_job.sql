-- ADR 0087 lot c (SEC-16): the synthesis of a script she sent is told in her creator under the app role (withTenantJob,
-- app.job = 'drop_media'), no longer as the service role. The job reads what was told already and writes the brain's
-- telling only: never one by hand, never a validated one. No account's session sets app.job.
CREATE POLICY "job_read" ON "script_drop_summaries" AS PERMISSIVE FOR SELECT TO public USING ("script_drop_summaries"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'drop_media');--> statement-breakpoint
CREATE POLICY "job_insert" ON "script_drop_summaries" AS PERMISSIVE FOR INSERT TO public WITH CHECK ("script_drop_summaries"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'drop_media' and "script_drop_summaries"."author" = 'brain' and "script_drop_summaries"."validated_by" is null);
