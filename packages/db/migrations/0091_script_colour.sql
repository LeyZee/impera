-- The script's colour (ADR 0064 § 1): three tones per version of a structure. Additive; the versions written before
-- take the « Rouge » preset, a frozen version included (adding a column fires no trigger).
ALTER TABLE "script_structure_versions" ADD COLUMN "color" jsonb DEFAULT '{"primary":"#b0213a","secondary":"#c8283f","accent":"#d8324b"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "script_structure_versions" ADD CONSTRAINT "script_structure_versions_color_check" CHECK (jsonb_typeof("script_structure_versions"."color") = 'object');