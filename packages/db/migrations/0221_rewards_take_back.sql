-- ADR 0118 § 5 and § 7 (CHF-01): a gain a corrected net no longer justifies is taken back. No row is deleted: the job
-- `rewards.evaluate` dates the row (taken_back_at) and no screen reads it any more; a gain earned again is a new row,
-- with its new date and its reveal to play. The unique key therefore holds among the gains not taken back. A level
-- keeps the threshold it was reached at (basis_minor), so that moving the thresholds takes no rank back.
ALTER TABLE "reward_gains" DROP CONSTRAINT "reward_gains_once";--> statement-breakpoint
ALTER TABLE "reward_gains" ADD COLUMN "taken_back_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reward_gains" ADD COLUMN "basis_minor" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_gains_once" ON "reward_gains" USING btree ("user_id","kind","scope_key") WHERE "reward_gains"."taken_back_at" is null;--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_taken_back_check" CHECK ("reward_gains"."taken_back_at" is null or "reward_gains"."taken_back_at" >= "reward_gains"."earned_at");--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_basis_check" CHECK ("reward_gains"."basis_minor" is null or ("reward_gains"."kind" = 'level' and "reward_gains"."basis_minor" > 0));--> statement-breakpoint
-- The levels already noted take today's threshold of their rank as the one they were reached at; with none set, it
-- stays unknown and the rank is never taken back.
UPDATE "reward_gains" g SET "basis_minor" = t."threshold"
FROM (
	SELECT e.ordinality::text AS "rank", (e.value #>> '{}')::numeric::int AS "threshold"
	FROM "reward_level_settings" s, jsonb_array_elements(s."thresholds_minor") WITH ORDINALITY e
	WHERE jsonb_typeof(e.value) = 'number'
) t
WHERE g."kind" = 'level' AND g."scope_key" = t."rank" AND t."threshold" > 0;--> statement-breakpoint
-- The job alone takes a gain back, under the service role (ADR 0087): this one column, nothing else of a row. The
-- application keeps what it had: read, and the reveal alone.
GRANT UPDATE ("taken_back_at") ON "reward_gains" TO impera_service;