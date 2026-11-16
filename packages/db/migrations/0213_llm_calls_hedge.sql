-- OPS-15: a request's part in a hedged attempt (packages/llm). 'loser' was still running when the answer went out: its
-- cost counts in the day, latency reads leave it out. NULL: not hedged. Additive, no data touched.
ALTER TABLE "llm_calls" ADD COLUMN "hedge" text;--> statement-breakpoint
ALTER TABLE "llm_calls" ADD CONSTRAINT "llm_calls_hedge_check" CHECK ("llm_calls"."hedge" in ('winner', 'loser'));
