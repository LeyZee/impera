-- ADR 0164 § 9. Additive. « D'autres idées »: the code that asked may give other answers to a question still open,
-- three times at most. A request is counted before it is paid (`ideas_asked_at` set, one fewer left), one at a time;
-- it is then filled (other answers, the mark lifted) or given back (the mark lifted, one more left). The app role
-- gains the three columns it needs; a trigger keeps them to that door (app.job = 'creator_decisions'), on an open
-- question, through these three steps only: neither her account nor the owner's rewrites what she is offered, and
-- no answer changes without a request counted. The shape of `answers` stays held by `creator_decisions_answers_check`,
-- and `creator_id` is not a column the app role may change.
ALTER TABLE "creator_decisions" ADD COLUMN "ideas_asked_at" timestamp with time zone;--> statement-breakpoint
CREATE POLICY "asking_other_ideas" ON "creator_decisions" AS PERMISSIVE FOR UPDATE TO public USING ("creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'creator_decisions' and "creator_decisions"."state" = 'open') WITH CHECK ("creator_decisions"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and nullif(current_setting('app.job', true), '') = 'creator_decisions' and "creator_decisions"."state" = 'open');--> statement-breakpoint
GRANT UPDATE ("answers", "other_ideas_left", "ideas_asked_at") ON "creator_decisions" TO nirvana_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "creator_decisions_other_ideas"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  same_answers boolean := NEW.answers IS NOT DISTINCT FROM OLD.answers;
BEGIN
  IF same_answers
     AND NEW.other_ideas_left = OLD.other_ideas_left
     AND NEW.ideas_asked_at IS NOT DISTINCT FROM OLD.ideas_asked_at THEN
    RETURN NEW;
  END IF;
  IF nullif(current_setting('app.job', true), '') = 'creator_decisions'
     AND OLD.state = 'open'
     AND NEW.state = 'open' THEN
    -- Counted: one request fewer, marked as being written. A mark left by a run that stopped is taken over.
    IF same_answers AND NEW.ideas_asked_at IS NOT NULL AND NEW.other_ideas_left = OLD.other_ideas_left - 1 THEN
      RETURN NEW;
    END IF;
    -- Filled: other answers for the request counted.
    IF OLD.ideas_asked_at IS NOT NULL AND NEW.ideas_asked_at IS NULL AND NEW.other_ideas_left = OLD.other_ideas_left THEN
      RETURN NEW;
    END IF;
    -- Given back: nothing could be proposed.
    IF same_answers AND OLD.ideas_asked_at IS NOT NULL AND NEW.ideas_asked_at IS NULL AND NEW.other_ideas_left = OLD.other_ideas_left + 1 THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'creator_decisions: other answers come from the code that asked, on an open question, for a request counted' USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "creator_decisions_other_ideas" BEFORE UPDATE OF "answers", "other_ideas_left", "ideas_asked_at" ON "creator_decisions" FOR EACH ROW EXECUTE FUNCTION "creator_decisions_other_ideas"();
