-- ADR 0077: the first reminder of an end-of-shift report rings under its own reason, `own_shift_end`, which passes the
-- quiet hours and the daily cap as `own_shift_start` does. Only the list of reasons changes. The new check is added
-- NOT VALID, then validated apart: every row already there has one of the former reasons, and the validation takes a
-- lighter lock than a check checked as it is added.
ALTER TABLE "notification_deliveries" DROP CONSTRAINT "notification_deliveries_reason_check";--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_reason_check" CHECK ("notification_deliveries"."reason" in ('sale', 'own_shift_start', 'own_shift_end', 'reminder', 'routine', 'streak', 'team')) NOT VALID;--> statement-breakpoint
ALTER TABLE "notification_deliveries" VALIDATE CONSTRAINT "notification_deliveries_reason_check";
