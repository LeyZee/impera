-- Routing a conversation to a team member (ADR 0024, prerequisite of EQ-08 and EQ-10): a member whose scope is
-- `self` reads a conversation of his creators only when it is routed to him. Additive: a nullable column, an index.
ALTER TABLE "conversations" ADD COLUMN "routed_to_user_id" text;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_routed_to_user_id_user_id_fk" FOREIGN KEY ("routed_to_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_routed_to_idx" ON "conversations" USING btree ("routed_to_user_id","updated_at" DESC NULLS LAST) WHERE "conversations"."routed_to_user_id" is not null;