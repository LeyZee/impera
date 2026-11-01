-- Two creators never share a name (Charles, 28/10/2026): « Zoé », « zoe » and « ZOÉ » are the same creator. The
-- application writes `name_key` (`creatorNameKey` in packages/contracts: NFKD, marks and invisible characters dropped,
-- spaces folded, lowercase) and the unique index holds against two creations at once. Rows already there get the
-- nearest key SQL can compute without an extension: lowercase, spaces folded, the accented Latin letters plain. A
-- database that already holds two creators of one name refuses this migration: nothing is deployed, so there is no
-- renaming here, and a development database that refuses 0035 is created again.
ALTER TABLE "creators" ADD COLUMN "name_key" text;--> statement-breakpoint
UPDATE "creators" SET "name_key" = lower(translate(btrim(regexp_replace("display_name", '\s+', ' ', 'g')), 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy'));--> statement-breakpoint
ALTER TABLE "creators" ALTER COLUMN "name_key" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "creators_name_key_unique" ON "creators" USING btree ("name_key");
