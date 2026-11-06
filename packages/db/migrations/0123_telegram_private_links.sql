-- The private chat of a member's reset link (SEC-05 lot 2, ADR 0068 § 4). Additive. `telegram_link_codes`: the SHA-256
-- of the one-time code shown in the CRM, ten minutes, one per account; `telegram_private_links`: the private chat the
-- agency's bot found when that code came back by `/start`, one per account, for the reset link alone. Both read and
-- written by the admin role only: RLS forced without a policy, revoked from `nirvana_app`.
CREATE TABLE "telegram_link_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_link_codes_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "telegram_private_links" (
	"user_id" text PRIMARY KEY NOT NULL,
	"bot_id" uuid NOT NULL,
	"telegram_chat_id" text NOT NULL,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ADD CONSTRAINT "telegram_link_codes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_private_links" ADD CONSTRAINT "telegram_private_links_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_private_links" ADD CONSTRAINT "telegram_private_links_bot_id_telegram_bots_id_fk" FOREIGN KEY ("bot_id") REFERENCES "public"."telegram_bots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_link_codes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_private_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_private_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "telegram_link_codes", "telegram_private_links" FROM nirvana_app;
