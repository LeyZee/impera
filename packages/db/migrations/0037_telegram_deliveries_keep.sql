-- REG-28: removing a group the bot left or was banned from no longer erases its deliveries. The Dashboard's night
-- counts read them, so a group removed in the morning kept the night's urgent alerts out of the count. `chat_id` goes
-- nullable with ON DELETE SET NULL (its foreign key dropped and added again), and each delivery keeps its group's title
-- in `chat_title`, filled here for the rows already written. The unique (source_key, chat_id) keeps NULLS DISTINCT on
-- purpose: rows of removed groups never collide, and nothing new is written without a group. `chat_removed` joins the
-- error kinds: what still waited for the group when it was removed never left.
ALTER TABLE "telegram_bots" DROP CONSTRAINT "telegram_bots_last_poll_error_check";--> statement-breakpoint
ALTER TABLE "telegram_chats" DROP CONSTRAINT "telegram_chats_last_error_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_deliveries" DROP CONSTRAINT "telegram_deliveries_error_kind_check";--> statement-breakpoint
ALTER TABLE "telegram_deliveries" DROP CONSTRAINT "telegram_deliveries_chat_id_telegram_chats_id_fk";
--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ALTER COLUMN "chat_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD COLUMN "chat_title" text;--> statement-breakpoint
UPDATE "telegram_deliveries" SET "chat_title" = "telegram_chats"."title" FROM "telegram_chats" WHERE "telegram_chats"."id" = "telegram_deliveries"."chat_id";--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ALTER COLUMN "chat_title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_chat_id_telegram_chats_id_fk" FOREIGN KEY ("chat_id") REFERENCES "public"."telegram_chats"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "telegram_bots" ADD CONSTRAINT "telegram_bots_last_poll_error_check" CHECK ("telegram_bots"."last_poll_error" in ('token_shape', 'token_refused', 'bot_exists', 'bot_mismatch', 'bot_conflict', 'chat_unreachable', 'rate_limited', 'unreachable', 'routes_version_conflict', 'chat_removed'));--> statement-breakpoint
ALTER TABLE "telegram_chats" ADD CONSTRAINT "telegram_chats_last_error_kind_check" CHECK ("telegram_chats"."last_error_kind" in ('token_shape', 'token_refused', 'bot_exists', 'bot_mismatch', 'bot_conflict', 'chat_unreachable', 'rate_limited', 'unreachable', 'routes_version_conflict', 'chat_removed'));--> statement-breakpoint
ALTER TABLE "telegram_deliveries" ADD CONSTRAINT "telegram_deliveries_error_kind_check" CHECK ("telegram_deliveries"."error_kind" in ('token_shape', 'token_refused', 'bot_exists', 'bot_mismatch', 'bot_conflict', 'chat_unreachable', 'rate_limited', 'unreachable', 'routes_version_conflict', 'chat_removed'));