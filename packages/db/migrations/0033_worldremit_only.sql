-- The chatters are paid by WorldRemit only (Charles, 28/10/2026): the closed list of 0031 (bank_transfer, wise, paypal,
-- other, a default set while waiting for his answer) becomes 'worldremit' alone, under the same constraint name. A
-- database that holds a statement paid by another method refuses this migration: nothing is deployed and no statement
-- was ever paid for real, so there is no backfill, and a development database that refuses 0033 is created again.
ALTER TABLE "commission_statements" DROP CONSTRAINT "commission_statements_payment_method_check";--> statement-breakpoint
ALTER TABLE "commission_statements" ADD CONSTRAINT "commission_statements_payment_method_check" CHECK ("commission_statements"."payment_method" in ('worldremit'));