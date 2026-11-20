-- The removal of an owner by the other (ADR 0096 § 2). Additive. `owner_removals`: asked, it waits 72 hours and the
-- owner it is about can cancel it; the notice is a constraint of the table, so no row takes effect sooner. Never
-- deleted. Read and written by the service role only: RLS forced without a policy, revoked from `nirvana_app`.
-- `notification_deliveries` takes the reason `owner_change`.
CREATE TABLE "owner_removals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_user_id" text NOT NULL,
	"requested_by" text NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"cancelled_at" timestamp with time zone,
	"applied_at" timestamp with time zone,
	CONSTRAINT "owner_removals_notice_check" CHECK ("owner_removals"."effective_at" >= "owner_removals"."requested_at" + interval '72 hours'),
	CONSTRAINT "owner_removals_not_self_check" CHECK ("owner_removals"."target_user_id" <> "owner_removals"."requested_by"),
	CONSTRAINT "owner_removals_one_end_check" CHECK ("owner_removals"."cancelled_at" is null or "owner_removals"."applied_at" is null),
	CONSTRAINT "owner_removals_applied_check" CHECK ("owner_removals"."applied_at" is null or "owner_removals"."applied_at" >= "owner_removals"."effective_at")
);
--> statement-breakpoint
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_reason_check";--> statement-breakpoint
ALTER TABLE "owner_removals" ADD CONSTRAINT "owner_removals_target_user_id_user_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_removals" ADD CONSTRAINT "owner_removals_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "owner_removals_waiting_unique" ON "owner_removals" USING btree ("target_user_id") WHERE "owner_removals"."cancelled_at" is null and "owner_removals"."applied_at" is null;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'own_shift_end', 'reminder', 'routine', 'streak', 'team', 'agency_share', 'creator_alert', 'safety_alert', 'owner_change'));--> statement-breakpoint
ALTER TABLE "owner_removals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "owner_removals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- From nothing, whatever the default privileges gave: the app role never reaches it, the service role never deletes.
REVOKE ALL ON "owner_removals" FROM nirvana_app;--> statement-breakpoint
REVOKE ALL ON "owner_removals" FROM impera_service;--> statement-breakpoint
GRANT SELECT, INSERT ON "owner_removals" TO impera_service;--> statement-breakpoint
-- Its end only: who is removed, who asked and the notice never change once written.
GRANT UPDATE ("cancelled_at", "applied_at") ON "owner_removals" TO impera_service;
