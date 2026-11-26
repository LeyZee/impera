-- ADR 0159 § 5: a dispo opens to the agency or to a fan's cam; every dispo saved before is the agency's. Additive.
ALTER TABLE "creator_availabilities" ADD COLUMN "opens_to" text DEFAULT 'agency' NOT NULL;--> statement-breakpoint
ALTER TABLE "creator_availabilities" ADD CONSTRAINT "creator_availabilities_opens_to_check" CHECK ("creator_availabilities"."opens_to" in ('agency', 'cam'));