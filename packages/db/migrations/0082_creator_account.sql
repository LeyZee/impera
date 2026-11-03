ALTER TABLE "user" ADD CONSTRAINT "user_creator_link_check" CHECK ("user"."role" <> 'creator' or cardinality("user"."creator_ids") = 1);--> statement-breakpoint
CREATE POLICY "creator_closed" ON "calibration_ratings" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "conversation_events" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_insert" ON "conversations" AS RESTRICTIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_update" ON "conversations" AS RESTRICTIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_delete" ON "conversations" AS RESTRICTIVE FOR DELETE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "drafts" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_insert" ON "messages" AS RESTRICTIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_update" ON "messages" AS RESTRICTIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_delete" ON "messages" AS RESTRICTIVE FOR DELETE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_insert" ON "fans" AS RESTRICTIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_update" ON "fans" AS RESTRICTIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_delete" ON "fans" AS RESTRICTIVE FOR DELETE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_closed" ON "llm_calls" AS RESTRICTIVE FOR ALL TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_insert" ON "media_descriptions" AS RESTRICTIVE FOR INSERT TO public WITH CHECK (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_update" ON "media_descriptions" AS RESTRICTIVE FOR UPDATE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');--> statement-breakpoint
CREATE POLICY "creator_no_delete" ON "media_descriptions" AS RESTRICTIVE FOR DELETE TO public USING (current_setting('app.account_role', true) is distinct from 'creator');