-- INS-03 (ADR 0121 § 1, ADR 0120 § 3, ADR 0080 § 4): her redirect links leave the Telegram channel's setting for their
-- own table. Written through the server alone (service role, after the role check): no write policy, the application
-- role only selects. She reads her own links that are on and placed, the owner and an active manager read the links
-- of the creator at hand, a chatter reads none. Additive: `telegram_channels.config` is not touched, its `links` stay
-- as a fallback for one version; emptying them is a later migration of its own.
CREATE TABLE "redirect_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"creator_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"destination" text DEFAULT '' NOT NULL,
	"placement" text,
	"usage_note" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "redirect_links_creator_name_unique" UNIQUE("creator_id","name"),
	CONSTRAINT "redirect_links_placement_check" CHECK ("redirect_links"."placement" in ('story_highlight', 'story_daily', 'telegram_channel', 'other_network')),
	CONSTRAINT "redirect_links_name_check" CHECK (char_length("redirect_links"."name") between 1 and 60),
	CONSTRAINT "redirect_links_url_check" CHECK ("redirect_links"."url" ~ '^https://[^[:space:]]+$' and char_length("redirect_links"."url") <= 2048),
	CONSTRAINT "redirect_links_destination_check" CHECK (char_length("redirect_links"."destination") <= 120),
	CONSTRAINT "redirect_links_usage_note_check" CHECK (char_length("redirect_links"."usage_note") <= 120)
);
--> statement-breakpoint
ALTER TABLE "redirect_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "redirect_links" ADD CONSTRAINT "redirect_links_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect_links" ADD CONSTRAINT "redirect_links_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "redirect_links_creator_idx" ON "redirect_links" USING btree ("creator_id");--> statement-breakpoint
CREATE POLICY "creator_read" ON "redirect_links" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) = 'creator' and "redirect_links"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid and "redirect_links"."enabled" and "redirect_links"."placement" is not null);--> statement-breakpoint
CREATE POLICY "team_read" ON "redirect_links" AS PERMISSIVE FOR SELECT TO public USING (current_setting('app.account_role', true) is distinct from 'creator' and nullif(current_setting('app.team_scope', true), '') in ('owner', 'agency') and "redirect_links"."creator_id" = nullif(current_setting('app.creator_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "redirect_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "redirect_links" FROM nirvana_app;--> statement-breakpoint
GRANT SELECT ON "redirect_links" TO nirvana_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "redirect_links" TO impera_service;--> statement-breakpoint
-- The links already kept in the channel's setting, with their identifiers. Their place is unknown: NULL, « à
-- renseigner » on screen, nothing attributed. Replayable: a link already copied is left as it is; a link whose shape
-- the table would refuse (a name already taken for her, an address that is not https) is left in the setting.
INSERT INTO "redirect_links" ("id", "creator_id", "name", "url", "destination", "updated_by")
SELECT DISTINCT ON (c."creator_id", btrim(l->>'name'))
  (l->>'id')::uuid, c."creator_id", btrim(l->>'name'), l->>'url', coalesce(left(btrim(l->>'destination'), 120), ''), c."updated_by"
FROM "telegram_channels" c
CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(c."config"->'links') = 'array' THEN c."config"->'links' ELSE '[]'::jsonb END) AS l
WHERE l->>'id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND char_length(btrim(l->>'name')) BETWEEN 1 AND 60
  AND l->>'url' ~ '^https://[^[:space:]]+$' AND char_length(l->>'url') <= 2048
ORDER BY c."creator_id", btrim(l->>'name'), (l->>'id')
ON CONFLICT DO NOTHING;
