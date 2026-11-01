-- The API's shared rate limiter (ADR 0027, OPS-01): one counter per hashed key and window, read and written by every
-- instance of the API. Additive. UNLOGGED by hand (Drizzle cannot say it): the counters are disposable, written on
-- every request, and a crash only opens a fresh window. Out of RLS like worker_heartbeats: no tenant data.
CREATE UNLOGGED TABLE "rate_limit_counters" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"window_ends_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_counters_key_check" CHECK (char_length("rate_limit_counters"."key") <= 512),
	CONSTRAINT "rate_limit_counters_hits_check" CHECK ("rate_limit_counters"."hits" > 0)
);
--> statement-breakpoint
CREATE INDEX "rate_limit_counters_window_ends_at_idx" ON "rate_limit_counters" USING btree ("window_ends_at");--> statement-breakpoint
-- Added by hand after `drizzle-kit generate`: the default privileges of init.sql exist neither in the test databases
-- nor on Neon.
GRANT SELECT, INSERT, UPDATE, DELETE ON "rate_limit_counters" TO nirvana_app;
