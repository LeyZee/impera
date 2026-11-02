import {
  CommissionStatementIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  type PayPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';
import { inventedLogo } from '../modules/invoicing/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const quiet = { warn: () => undefined, error: () => undefined };

/**
 * ADR 0047 § 1: pay asks the invoices whether a transfer may go (`PayoutGate`), in its own transaction. The concurrent
 * case: the credit note a statement owes is being issued while the owner pays it. The issue holds the contractor's lock
 * until it commits; the payment that comes meanwhile sees none of its documents and is refused, never recorded with a
 * credit note missing. Once the documents are issued, the same payment goes, and the transfer settles both.
 */
describe('Équipe › Paie : un avoir émis pendant un paiement (ADR 0047 § 1, ADR 0041)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;

  const db = () => team.test.admin.db;
  const issue = async (period: PayPeriod) =>
    team.app.modules.invoicing.jobs.issueInvoices(
      CommissionStatementIdSchema.parse((await team.statementOf(theo, period)).id),
      quiet,
    );
  const pay = async (period: PayPeriod) => {
    const { id, revision, payableMinor } = await team.statementOf(theo, period);
    return team.call('POST', `/payroll/statements/${id}/pay`, team.owner, {
      revision,
      paidOn: '2025-07-31',
      method: 'worldremit',
      sentMinor: payableMinor,
    });
  };
  const documentsOf = async (period: PayPeriod) => {
    const { id } = await team.statementOf(theo, period);
    return (
      await db()
        .select({ kind: schema.invoices.kind })
        .from(schema.invoices)
        .where(eq(schema.invoices.statementId, id))
    )
      .map((one) => one.kind)
      .sort();
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      invoiceBuckets: { primary: createMemoryInvoiceStore(), copy: createMemoryInvoiceStore() },
    });
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
    ]);
    await invoicing.acceptMandate(theo);
    await team.report(theo, Q1, 123_450);
    await team.report(theo, Q2, 100_000);
    await team.recalculate(Q1);
    expect((await team.validate(team.owner, theo, Q1)).statusCode).toBe(200);
    await issue(Q1);
    // A sale of Q1 refunded: it counts in Q2, whose documents are its invoice and a credit note on Q1's.
    const adjusted = await team.call('POST', '/payroll/adjustments', team.owner, {
      id: newId(PayAdjustmentIdSchema),
      memberId: theo.id,
      amountMinor: -250,
      reason: 'Vente remboursée par la plateforme',
      correctsStatementId: (await team.statementOf(theo, Q1)).id,
    });
    expect(adjusted.statusCode, adjusted.body).toBe(201);
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, theo, Q2)).statusCode).toBe(200);
  });

  afterAll(() => team.close());

  it('refuses a transfer while its credit note is being issued, then lets it go and settles both', async () => {
    // The contractor's lock held by a transaction of the test: the issue of Q2 waits on it, as on another issue.
    let release = (): void => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = (): void => undefined;
    const holding = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const holder = db().transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`invoices.issue:${theo.id}`}, 0))`,
      );
      locked();
      await released;
    });
    await holding;
    const issuing = issue(Q2);

    expect((await team.statementOf(theo, Q2)).payableMinor).toBeGreaterThan(0);
    const during = await pay(Q2);
    expect(during.statusCode, during.body).toBe(409);
    expect(during.json()).toMatchObject({
      error: { code: 'payout_blocked_conflict', details: { reason: 'documents_not_issued', year: null } },
    });
    expect(await documentsOf(Q2)).toEqual([]);
    expect((await team.statementOf(theo, Q2)).status).toBe('validated');

    release();
    await holder;
    expect(await issuing).toMatchObject({ kind: 'planned' });
    expect(await documentsOf(Q2)).toEqual(['credit_note', 'invoice']);

    const after = await pay(Q2);
    expect(after.statusCode, after.body).toBe(200);
    expect(await team.app.modules.invoicing.jobs.settleDocuments(theo.id)).toBe(2);
  });
});
