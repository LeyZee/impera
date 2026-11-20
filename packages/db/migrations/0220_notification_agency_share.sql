-- An alert on the agency's share (ADR 0054 §§ 2 and 5) rings the owner's devices too, not only Telegram (PAY-04 of the
-- recette of 16/11): one more reason for a notification, under the rules of every other.
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_reason_check";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'own_shift_end', 'reminder', 'routine', 'streak', 'team', 'agency_share'));
