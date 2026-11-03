-- The blocked issues `payroll.requeue_invoice_issues` gives again, read through their own index rather than across the
-- whole outbox, all of them or one contractor's (ARC-08, remark of Équipe on #423). No row changes.
CREATE INDEX "domain_events_invoice_not_issued_idx" ON "domain_events" USING btree (("payload"->>'memberId')) WHERE "domain_events"."type" = 'invoice_not_issued';
