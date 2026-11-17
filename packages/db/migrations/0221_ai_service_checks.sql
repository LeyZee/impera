-- ADR 0091 § 7 (« ok essai IA » de Charles, 16/11/2026): the owner's « Essai réel » of a service is journaled with the
-- purpose 'probe'; provider_credentials keeps the last one and ElevenLabs' month (limit, reset, offer). Additive, no
-- data touched: the new columns start null.
ALTER TABLE "llm_calls" DROP CONSTRAINT "llm_calls_purpose_check";--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "characters_limit" integer;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "characters_reset_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "plan_tier" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "probed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "probe_outcome" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "probe_latency_ms" integer;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "probe_model" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_plan_tier_check" CHECK ("provider_credentials"."plan_tier" in ('free', 'paid'));--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_probe_outcome_check" CHECK ("provider_credentials"."probe_outcome" in ('answers', 'budget_reached', 'no_voice', 'no_credit', 'key_refused', 'model_missing', 'rate_limited', 'timeout', 'not_answering'));--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_purpose_check" CHECK ("llm_calls"."purpose" in ('chatting', 'trend_watch', 'probe'));
