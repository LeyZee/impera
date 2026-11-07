-- ADR 0077: the first reminder of an end-of-shift report rings under its own reason, `own_shift_end`, which passes the
-- quiet hours and the daily cap as `own_shift_start` does. Only the list of reasons changes. The new check is added
-- NOT VALID, then validated: every row already there has one of the former reasons. The three statements run in one
-- transaction, so the strong lock taken by ADD CONSTRAINT holds to the end; the table is small.
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_reason_check";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'own_shift_end', 'reminder', 'routine', 'streak', 'team')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notification_deliveries" VALIDATE CONSTRAINT "notification_deliveries_reason_check";
