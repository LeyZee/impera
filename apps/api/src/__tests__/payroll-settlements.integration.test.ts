import {
  CommissionStatementIdSchema,
  InvoiceEventIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  type PayPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, inArray, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/payroll';
import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const Q4 = PayPeriodSchema.parse('2025-06-16');
const Q5 = PayPeriodSchema.parse('2025-07-01');
const Q6 = PayPeriodSchema.parse('2025-07-16');

const quiet = { warn: () => undefined, error: () => undefined };
const KEPT = /does not follow where invoice/u;

describe('Équipe › Factures : le rapprochement des versements (EQ-06 lot 7a, ADR 0038)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;

  const db = () => team.test.admin.db;
  const settle = (memberId: TeamMember['id'] | null) =>
    team.app.modules.payroll.jobs.settleDocuments(memberId);

  /** The statement of a period, validated, with its documents issued. */
  const close = async (period: PayPeriod) => {
    await team.recalculate(period);
    expect((await team.validate(team.owner, theo, period)).statusCode).toBe(200);
    const statement = await team.statementOf(theo, period);
    await team.app.modules.payroll.jobs.issueInvoices(CommissionStatementIdSchema.parse(statement.id), quiet);
    return team.statementOf(theo, period);
  };

  const pay = async (period: PayPeriod, paidOn: string) => {
    const { id, revision, payableMinor } = await team.statementOf(theo, period);
    const response = await team.call('POST', `/payroll/statements/${id}/pay`, team.owner, {
      revision,
      paidOn,
      method: 'worldremit',
      sentMinor: payableMinor,
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  const adjust = async (amountMinor: number, corrects: PayPeriod, reason: string) => {
    const response = await team.call('POST', '/payroll/adjustments', team.owner, {
      id: newId(PayAdjustmentIdSchema),
      memberId: theo.id,
      amountMinor,
      reason,
      correctsStatementId: (await team.statementOf(theo, corrects)).id,
    });
    expect(response.statusCode, response.body).toBe(201);
  };

  /** Each document of a period's statement, by kind. */
  const documentOf = async (period: PayPeriod, kind: 'invoice' | 'credit_note') => {
    const { id } = await team.statementOf(theo, period);
    const [document] = await db()
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.statementId, id), eq(schema.invoices.kind, kind)));
    if (document === undefined) throw new Error(`no ${kind} for ${period}`);
    return document;
  };

  /** The settlements written, as « number: kind by period ». */
  const settlements = async () => {
    const rows = await db()
      .select({
        number: schema.invoices.number,
        kind: schema.invoiceEvents.kind,
        period: schema.commissionStatements.period,
        by: schema.invoiceEvents.by,
      })
      .from(schema.invoiceEvents)
      .innerJoin(schema.invoices, eq(schema.invoices.id, schema.invoiceEvents.invoiceId))
      .innerJoin(
        schema.commissionStatements,
        eq(schema.commissionStatements.id, schema.invoiceEvents.statementId),
      )
      .where(inArray(schema.invoiceEvents.kind, ['paid', 'imputed', 'compensated']))
      .orderBy(schema.invoices.sequence);
    expect(rows.every((row) => row.by === null)).toBe(true);
    return rows.map((row) => `${row.number}: ${row.kind} by ${row.period}`);
  };

  /** A settlement written by hand, as no code does: the trigger's answer. */
  const write = async (invoiceId: string, kind: string, period: PayPeriod, by: string | null = null) => {
    const statementId = (await team.statementOf(theo, period)).id;
    try {
      await db()
        .insert(schema.invoiceEvents)
        .values({ id: newId(InvoiceEventIdSchema), invoiceId, kind, statementId, by });
      return 'written';
    } catch (error) {
      return error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
    }
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
    // A whole quinzaine, then a small one carried (ADR 0038), then the later ones the steps below write.
    await team.report(theo, Q1, 10_000);
    await team.report(theo, Q2, 5_000);
    await team.report(theo, Q4, 5_000);
    await team.report(theo, Q6, 10_000);
  });

  afterAll(() => team.close());

  it('settles each document once, by the statement that ends its debt, through the carry-overs', async () => {
    const year = (await close(Q1)).validatedAt?.getFullYear();
    const number = (sequence: number) => `THEO-${String(year)}-000${String(sequence)}`;
    // The validation enqueues the settlement under the contractor's key; nothing is settled before the transfer.
    const jobs = await db().execute<{ payload: unknown }>(
      sql`select payload from graphile_worker._private_jobs where key = ${`payroll.settle_documents:${theo.id}`}`,
    );
    expect(jobs.rows).toEqual([{ payload: { memberId: theo.id } }]);
    expect(await settle(theo.id)).toBe(0);

    // Its own transfer pays the first invoice, enqueued again by the payment.
    await pay(Q1, '2025-05-20');
    expect(await settle(theo.id)).toBe(1);
    expect(await settlements()).toEqual([`${number(1)}: paid by ${Q1}`]);

    // A small quinzaine is carried: its invoice waits.
    expect((await close(Q2)).carryOverOutMinor).toBeGreaterThan(0);
    expect(await settle(theo.id)).toBe(0);

    // Refunds of the first quinzaine above what is carried: the cumulated total is below zero. The agency owes
    // nothing any more for the small quinzaine (its invoice is compensated); the credit note waits for the rest.
    await adjust(-1_200, Q1, 'Vente remboursée par la plateforme');
    const third = await close(Q3);
    expect(third.totalMinor).toBeLessThan(0);
    expect(third.carryOverOutMinor).toBe(third.totalMinor);
    expect(await settle(theo.id)).toBe(1);
    expect(await settlements()).toEqual([
      `${number(1)}: paid by ${Q1}`,
      `${number(2)}: compensated by ${Q3}`,
    ]);

    // A small quinzaine again, carried with what is left of the debt; then a refund that brings the cumul to zero:
    // nothing is sent, and the two credit notes and the last invoice end by compensation.
    const fourth = await close(Q4);
    expect(fourth.carryOverOutMinor).toBe(fourth.totalMinor);
    expect(fourth.totalMinor).toBeGreaterThan(0);
    await adjust(-fourth.totalMinor, Q4, 'Second pack remboursé');
    const fifth = await close(Q5);
    expect([fifth.totalMinor, fifth.carryOverOutMinor]).toEqual([0, 0]);
    expect(await settle(theo.id)).toBe(3);
    expect(await settlements()).toEqual([
      `${number(1)}: paid by ${Q1}`,
      `${number(2)}: compensated by ${Q3}`,
      `${number(3)}: compensated by ${Q5}`,
      `${number(4)}: compensated by ${Q5}`,
      `${number(5)}: compensated by ${Q5}`,
    ]);

    // A whole quinzaine paid. A settlement written by hand is kept to the statement the walk ends at, by no author,
    // once (the trigger and the unique index): no code writes one but the job.
    await close(Q6);
    await pay(Q6, '2025-07-31');
    const [first, small, refund, sixth] = await Promise.all([
      documentOf(Q1, 'invoice'),
      documentOf(Q2, 'invoice'),
      documentOf(Q3, 'credit_note'),
      documentOf(Q6, 'invoice'),
    ]);
    expect(await write(first.id, 'paid', Q1)).toMatch(/invoice_events_settled_unique/u);
    expect(await write(small.id, 'paid', Q6)).toMatch(KEPT);
    expect(await write(refund.id, 'imputed', Q6)).toMatch(KEPT);
    expect(await write(sixth.id, 'imputed', Q6)).toMatch(KEPT);
    expect(await write(sixth.id, 'compensated', Q6)).toMatch(KEPT);
    expect(await write(sixth.id, 'paid', Q5)).toMatch(KEPT);
    expect(await write(sixth.id, 'paid', Q1)).toMatch(KEPT);
    expect(await write(sixth.id, 'paid', Q6, team.ownerId)).toMatch(KEPT);
    // The night's run for every contractor writes only what is missing.
    expect(await settle(null)).toBe(1);
    expect(await settle(null)).toBe(0);
    expect(await settle(theo.id)).toBe(0);
    expect((await settlements()).at(-1)).toBe(`${number(6)}: paid by ${Q6}`);
    expect(await team.audited('invoice.paid')).toBe(2);
    expect(await team.audited('invoice.compensated')).toBe(2);
    expect(await team.audited('credit_note.compensated')).toBe(2);
  });
});
