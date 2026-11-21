-- ADR 0118 § 5 and § 7 (CHF-01): a gain a corrected net no longer justifies is taken back. No row is deleted: the job
-- `rewards.evaluate` dates the row (taken_back_at) and no screen reads it any more; a gain earned again is a new row,
-- with its new date and its reveal to play. The unique key therefore holds among the gains not taken back. A level
-- keeps the threshold it was reached at (basis_minor), so that moving the thresholds takes no rank back.
ALTER TABLE "reward_gains" DROP CONSTRAINT "reward_gains_once";--> statement-breakpoint
ALTER TABLE "reward_gains" ADD COLUMN "taken_back_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "reward_gains" ADD COLUMN "basis_minor" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "reward_gains_once" ON "reward_gains" USING btree ("user_id","kind","scope_key") WHERE "reward_gains"."taken_back_at" is null;--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_taken_back_check" CHECK ("reward_gains"."taken_back_at" is null or "reward_gains"."taken_back_at" >= "reward_gains"."earned_at");--> statement-breakpoint
ALTER TABLE "reward_gains" ADD CONSTRAINT "reward_gains_basis_check" CHECK ("reward_gains"."basis_minor" is null or ("reward_gains"."kind" = 'level' and "reward_gains"."basis_minor" >= 0));--> statement-breakpoint
-- The levels noted before this migration keep no threshold: today's is not the one of the day they were reached, so
-- they are never taken back. Only a rank noted from now on carries its own.
-- Taking back is never undone: a gain earned again is a new row, so the date of the first one and its reveal stay.
CREATE FUNCTION reward_gains_taken_back_stays() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
	IF OLD."taken_back_at" IS NOT NULL AND NEW."taken_back_at" IS DISTINCT FROM OLD."taken_back_at" THEN
		RAISE EXCEPTION 'reward_gains: a gain taken back stays taken back' USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "reward_gains_taken_back_stays" BEFORE UPDATE OF "taken_back_at" ON "reward_gains"
	FOR EACH ROW EXECUTE FUNCTION reward_gains_taken_back_stays();--> statement-breakpoint
-- The job alone takes a gain back, under the service role (ADR 0087): this one column, nothing else of a row. The
-- application keeps what it had: read, and the reveal alone.
GRANT UPDATE ("taken_back_at") ON "reward_gains" TO impera_service;