-- VEI-01 lot c (ADR 0060 § 7). What each LLM call was for: the trend watch is summed apart, under its own cap inside
-- the daily one, so that it never deprives a fan's answer of budget. Every call journaled until now served the fans
-- and their conversations: `chatting`, the default.
ALTER TABLE "llm_calls" ADD COLUMN "purpose" text DEFAULT 'chatting' NOT NULL;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_purpose_check" CHECK ("llm_calls"."purpose" in ('chatting', 'trend_watch'));
