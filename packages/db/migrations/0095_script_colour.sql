-- The script's colour (ADR 0064 § 1): three tones per version of a structure. Additive; the versions written before
-- take the « Rouge » preset, a frozen version included (adding a column fires no trigger).
ALTER TABLE "script_structure_versions" ADD COLUMN "color" jsonb DEFAULT '{"primary":"#b0213a","secondary":"#c8283f","accent":"#d8324b"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "script_structure_versions" ADD CONSTRAINT "script_structure_versions_color_check" CHECK (jsonb_typeof("script_structure_versions"."color") = 'object');--> statement-breakpoint
-- ADR 0064 § 3: a stage says whether it is free or paid, a bridge may carry media slots. The versions not yet asked of
-- a creator get them here: a stage written before is paid (`access` « paid », the default the ADR names), a bridge
-- carries no slot. A frozen version never changes (rule 6, trigger of 0084): the store reads it with the same defaults.
UPDATE "script_structure_versions" SET "segments" = (
  SELECT jsonb_agg(
    CASE
      WHEN "segment"->>'kind' = 'stage' AND NOT "segment" ? 'access' THEN "segment" || '{"access":"paid"}'::jsonb
      WHEN "segment"->>'kind' = 'bridge' AND NOT "segment" ? 'mediaSlots' THEN "segment" || '{"mediaSlots":[]}'::jsonb
      ELSE "segment"
    END ORDER BY "position")
  FROM jsonb_array_elements("script_structure_versions"."segments") WITH ORDINALITY AS "listed"("segment", "position")
)
WHERE "frozen_at" IS NULL AND jsonb_typeof("segments") = 'array' AND jsonb_array_length("segments") > 0;
