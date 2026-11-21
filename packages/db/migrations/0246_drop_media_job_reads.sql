-- ADR 0087 lot c (SEC-16): the two jobs on a medium she dropped (its reduced picture, its description) run in her
-- creator under the app role (withTenantJob, app.job = 'drop_media'), no longer as the service role. They read what the
-- drop says of the medium: a read policy that only this job passes (no account's session sets app.job). Nothing is
-- written to these three tables by the job; media_assets already follows the creator of the transaction.
CREATE POLICY "job_read" ON "content_drop_files" AS PERMISSIVE FOR SELECT TO public USING ("content_drop_files"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'drop_media');--> statement-breakpoint
CREATE POLICY "job_read" ON "content_drops" AS PERMISSIVE FOR SELECT TO public USING ("content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'drop_media');--> statement-breakpoint
CREATE POLICY "job_read" ON "content_requests" AS PERMISSIVE FOR SELECT TO public USING ("content_requests"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'drop_media');
