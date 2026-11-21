-- ADR 0102 § 5: « Retirer » takes an example out of her bank. calibration_ratings stays append-only (0005): the only
-- changes allowed are the purge of `moment` and, now, an example `active` or `blocked` becoming `withdrawn`, with the
-- time it happened, everything else as it was. Still no DELETE, whoever asks.
CREATE OR REPLACE FUNCTION "calibration_ratings_purge_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.moment IS NULL
     AND NEW.moment_purged_at IS NOT NULL
     AND OLD.moment IS NOT NULL
     AND (to_jsonb(NEW) - 'moment' - 'moment_purged_at') = (to_jsonb(OLD) - 'moment' - 'moment_purged_at') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND OLD.example_state IN ('active', 'blocked')
     AND NEW.example_state = 'withdrawn'
     AND NEW.example_state_at IS NOT NULL
     AND (to_jsonb(NEW) - 'example_state' - 'example_state_at') = (to_jsonb(OLD) - 'example_state' - 'example_state_at') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'calibration_ratings is append-only (only moment may be purged, an example withdrawn)' USING ERRCODE = 'restrict_violation';
END;
$$;
