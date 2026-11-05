-- ADR 0045 § 5 (CR-05): a creator's calendar link may also give her accounts' shifts. Her choice, false until she
-- makes it; a new address keeps it. Adds a column with a default: no row changes meaning.
ALTER TABLE "calendar_links" ADD COLUMN "with_shifts" boolean DEFAULT false NOT NULL;
