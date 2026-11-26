-- ADR 0164 § 9. Additive. The captions proposed for a Reel are journaled under their own purpose.
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_purpose_check";--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_purpose_check" CHECK ("llm_calls"."purpose" in ('chatting', 'trend_watch', 'probe', 'instagram_comment', 'media', 'telegram', 'instagram_caption'));
