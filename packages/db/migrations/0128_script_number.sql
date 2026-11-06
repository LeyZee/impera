ALTER TABLE "content_drops" ADD COLUMN "script_number" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "content_drops_script_number_unique" ON "content_drops" USING btree ("creator_id","script_number") WHERE "content_drops"."script_number" is not null;--> statement-breakpoint
ALTER TABLE "content_drops" ADD CONSTRAINT "content_drops_script_number_check" CHECK ("content_drops"."script_number" is null or ("content_drops"."category" = 'script' and "content_drops"."script_number" >= 1));--> statement-breakpoint
ALTER POLICY "creator_insert" ON "content_drops" TO public WITH CHECK (current_setting('app.account_role', true) = 'creator' and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."created_by" = nullif(current_setting('app.user_id', true), '')
        and ("content_drops"."state" = 'uploading' or ("content_drops"."state" = 'filling' and "content_drops"."category" = 'script'))
        and "content_drops"."corrected_from" is null and "content_drops"."script_number" is null and ("content_drops"."request_id" is null or exists (
          select 1 from content_requests r
           where r.id = "content_drops"."request_id" and r.creator_id = "content_drops"."creator_id" and r.state = 'open' and r.category = "content_drops"."category"
        )));--> statement-breakpoint
ALTER POLICY "team_insert" ON "content_drops" TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "content_drops"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "content_drops"."created_by" = nullif(current_setting('app.user_id', true), '') and "content_drops"."state" = 'uploading'
        and "content_drops"."corrected_from" is null and "content_drops"."script_number" is null and ("content_drops"."request_id" is null or exists (
          select 1 from content_requests r
           where r.id = "content_drops"."request_id" and r.creator_id = "content_drops"."creator_id" and r.state = 'open' and r.category = "content_drops"."category"
        )));