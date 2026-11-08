-- ADR 0085 § 5 and § 12: a chatter writes a field of the fan's card. `fan_facts.kind` gains `noted`, which names its
-- author (`noted_by`), and only it does. Nothing existing is rewritten; RLS unchanged (tenant policy, the creator reads
-- only). A cleared field is a `noted` line with an empty value (§ 6: nothing leaves the history before the purge).
ALTER TABLE "fan_facts" DROP CONSTRAINT "fan_facts_kind_check";--> statement-breakpoint
ALTER TABLE "fan_facts" ADD COLUMN "noted_by" text;--> statement-breakpoint
ALTER TABLE "fan_facts" ADD CONSTRAINT "fan_facts_noted_by_user_id_fk" FOREIGN KEY ("noted_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fan_facts" ADD CONSTRAINT "fan_facts_noted_by_check" CHECK (("fan_facts"."kind" = 'noted') = ("fan_facts"."noted_by" is not null));--> statement-breakpoint
ALTER TABLE "fan_facts" ADD CONSTRAINT "fan_facts_kind_check" CHECK ("fan_facts"."kind" in ('declared', 'inferred', 'noted'));
