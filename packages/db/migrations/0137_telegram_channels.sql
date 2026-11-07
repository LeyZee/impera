-- ADR 0057 § 2, ADR 0080: the creator's Telegram channel. One row per creator: the channel the agency's bot posts in for
-- her (a `telegram_chats` row of kind `channel`, one creator at most), and the owner's setting stored whole (slots,
-- preview window, redirect links, `TelegramChannelConfigSchema`). Agency settings, like the other telegram tables:
-- RLS forced without a policy and revoked from `nirvana_app`, so only `withAdmin` reads or writes them.
CREATE TABLE "telegram_channels" (
	"creator_id" uuid PRIMARY KEY NOT NULL,
	"chat_id" uuid,
	"config" jsonb NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "telegram_channels_chat_unique" UNIQUE("chat_id")
);
--> statement-breakpoint
ALTER TABLE "telegram_channels" ADD CONSTRAINT "telegram_channels_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_channels" ADD CONSTRAINT "telegram_channels_chat_id_telegram_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."telegram_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_channels" ADD CONSTRAINT "telegram_channels_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "telegram_channels" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "telegram_channels" FROM nirvana_app;
