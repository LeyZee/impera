import {
  calendarDayAt,
  CommissionStatementIdSchema,
  InvoiceEventIdSchema,
  InvoiceIdSchema,
  InvoiceListSchema,
  newId,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const DAY = 86_400_000;
const quiet = { warn: () => undefined, error: () => undefined };
const dayNumber = (day: string): number => Date.parse(`${day}T00:00:00Z`) / DAY;

describe('Équipe › Factures : la liste des documents et leur échéance (EQ-06 lot 8)', () => {
  /** Pay's clock, moved forward by whole days to read the list on a later day. */
  const clock = { days: 0 };
  const shifted = (): Date => new Date(Date.now() + clock.days * DAY);
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let leaCookie: string;
  let monaCookie: string;
  let today: string;

  const list = (cookie: string, query: string) => team.call('GET', `/payroll/invoices?${query}`, cookie);
  const documents = async (cookie: string, query: string) => {
    const response = await list(cookie, query);
    expect(response.statusCode, response.body).toBe(200);
    return InvoiceListSchema.parse(response.json());
  };
  const invoiceOf = async (member: TeamMember, kind: 'invoice' | 'credit_note' = 'invoice', period = Q1) => {
    const [found] = await team.test.admin.db
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.memberId, member.id),
          eq(schema.invoices.kind, kind),
          eq(schema.invoices.statementId, (await team.statementOf(member, period)).id),
        ),
      );
    if (found === undefined) throw new Error(`no ${kind} for ${period}`);
    return found;
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), { payrollClock: shifted });
    today = calendarDayAt(new Date(), 'Europe/Paris');
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
    ({ cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
    ]);
    for (const member of [theo, lea]) {
      await invoicing.acceptMandate(member);
      await team.report(member, Q1, 10_000);
    }
    await team.recalculate(Q1);
    for (const member of [theo, lea]) {
      expect((await team.validate(team.owner, member, Q1)).statusCode).toBe(200);
      const statement = await team.statementOf(member, Q1);
      await team.app.modules.payroll.jobs.issueInvoices(
        CommissionStatementIdSchema.parse(statement.id),
        quiet,
      );
    }
    // Théo is paid: the transfer settles his invoice.
    const { id, revision, payableMinor } = await team.statementOf(theo, Q1);
    const paid = await team.call('POST', `/payroll/statements/${id}/pay`, team.owner, {
      revision,
      paidOn: today,
      method: 'worldremit',
      reference: 'WR-THEO',
      sentMinor: payableMinor,
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(await team.app.modules.payroll.jobs.settleDocuments(null)).toBe(1);
  });

  afterAll(() => team.close());

  it('refuses a list without a bound, a range of more than a year, and an unknown or repeated filter', async () => {
    for (const query of [
      '',
      'memberId=' + crypto.randomUUID(),
      'due=settled',
      'due=open,settled',
      'acceptance=accepted',
      'acceptance=pending,accepted',
      `from=${today}`,
      'from=2026-01-01&to=2025-12-31',
      'from=2025-01-01&to=2026-01-02',
      'due=late',
      'due=soon,soon',
      'due=',
      'period=2025-05-02',
    ]) {
      const response = await list(team.owner, query);
      expect([query, response.statusCode]).toEqual([query, 400]);
    }
    // 366 days of issue, both ends included, at most.
    expect((await list(team.owner, 'from=2025-01-01&to=2026-01-01')).statusCode).toBe(200);
  });

  it('gives each document with its acceptance, its settlement and its due state, to whoever reads it', async () => {
    const theoInvoice = await invoiceOf(theo);
    const leaInvoice = await invoiceOf(lea);
    const theoStatement = await team.statementOf(theo, Q1);
    const all = await documents(team.owner, `period=${Q1}`);
    expect(all.today).toBe(today);
    // The latest issued first, then by number: THEO after LEA in the alphabet, so first.
    expect(all.documents).toEqual([
      {
        id: theoInvoice.id,
        kind: 'invoice',
        corrective: false,
        memberId: theo.id,
        number: theoInvoice.number,
        period: Q1,
        statementId: theoStatement.id,
        statementPeriod: Q1,
        creditedInvoiceId: null,
        issuedOn: today,
        dueOn: theoInvoice.dueOn,
        exclVatMinor: theoInvoice.exclVatMinor,
        vatMinor: theoInvoice.vatMinor,
        inclVatMinor: theoInvoice.inclVatMinor,
        acceptance: {
          state: 'pending',
          deadline: theoInvoice.acceptanceDeadline.toISOString(),
          reason: null,
        },
        settlement: { kind: 'paid', statementId: theoStatement.id, on: today },
        due: 'settled',
        pdfReady: false,
      },
      expect.anything(),
    ]);
    expect(all.documents[1]).toMatchObject({
      id: leaInvoice.id,
      memberId: lea.id,
      settlement: null,
      due: 'open',
      acceptance: { state: 'pending' },
    });
    // An active manager reads the team's; a contractor only her own, whatever she asks.
    expect(await documents(monaCookie, `period=${Q1}`)).toEqual(all);
    // Her statement is hers under the policy of the statements: its quinzaine reads, never `null` for her.
    expect(
      (await documents(leaCookie, `period=${Q1}`)).documents.map((one) => [
        one.id,
        one.statementId,
        one.statementPeriod,
      ]),
    ).toEqual([[leaInvoice.id, (await team.statementOf(lea, Q1)).id, Q1]]);
    expect((await documents(leaCookie, `period=${Q1}&memberId=${theo.id}`)).documents).toEqual([]);
    expect(
      (await documents(team.owner, `from=${today}&to=${today}&memberId=${lea.id}`)).documents.map(
        (one) => one.id,
      ),
    ).toEqual([leaInvoice.id]);
    expect((await documents(team.owner, 'period=2025-05-16')).documents).toEqual([]);
  });

  it('turns an invoice not settled soon seven days before its due date, and overdue the day after', async () => {
    const leaInvoice = await invoiceOf(lea);
    const daysToDue = dayNumber(leaInvoice.dueOn) - dayNumber(today);
    const stateOn = async (shift: number) => {
      clock.days = shift;
      try {
        const read = await documents(team.owner, `period=${Q1}&memberId=${lea.id}`);
        expect(read.today).toBe(calendarDayAt(shifted(), 'Europe/Paris'));
        return read.documents[0]?.due;
      } finally {
        clock.days = 0;
      }
    };
    expect(await stateOn(daysToDue - 8)).toBe('open');
    expect(await stateOn(daysToDue - 7)).toBe('soon');
    expect(await stateOn(daysToDue)).toBe('soon');
    expect(await stateOn(daysToDue + 1)).toBe('overdue');

    // Without a date, the documents still waiting: Théo's, settled, is never among them.
    clock.days = daysToDue + 1;
    try {
      const waiting = await documents(team.owner, 'due=soon,overdue');
      expect(waiting.documents.map((one) => [one.id, one.due])).toEqual([[leaInvoice.id, 'overdue']]);
      expect((await documents(team.owner, 'due=soon')).documents).toEqual([]);
    } finally {
      clock.days = 0;
    }
  });

  it('lists the contests to settle without a date, and filters on any acceptance within a bound', async () => {
    const leaInvoice = await invoiceOf(lea);
    const theoInvoice = await invoiceOf(theo);
    const contested = await team.call('POST', `/payroll/invoices/${leaInvoice.id}/contest`, leaCookie, {
      reason: 'Il manque une soirée.',
    });
    expect(contested.statusCode, contested.body).toBe(200);
    const contests = await documents(team.owner, 'acceptance=contested');
    expect(contests.documents.map((one) => [one.id, one.acceptance.state, one.acceptance.reason])).toEqual([
      [leaInvoice.id, 'contested', 'Il manque une soirée.'],
    ]);
    expect((await documents(team.owner, 'acceptance=pending')).documents.map((one) => one.id)).toEqual([
      theoInvoice.id,
    ]);
    expect(
      (await documents(team.owner, `period=${Q1}&acceptance=contested&due=open`)).documents.map(
        (one) => one.id,
      ),
    ).toEqual([leaInvoice.id]);
    expect((await documents(team.owner, `period=${Q1}&due=settled`)).documents.map((one) => one.id)).toEqual([
      theoInvoice.id,
    ]);
  });

  it('lists a credit note with the quinzaine that owed it, never soon nor overdue, settled by the transfer', async () => {
    // Léa's next quinzaine gives back part of the first: a credit note on her first invoice, owed by Q2, and a total
    // still over the minimum payout.
    await team.report(lea, Q2, 40_000);
    const adjusted = await team.call('POST', '/payroll/adjustments', team.owner, {
      id: newId(PayAdjustmentIdSchema),
      memberId: lea.id,
      amountMinor: -1_200,
      reason: 'Vente remboursée par la plateforme',
      correctsStatementId: (await team.statementOf(lea, Q1)).id,
    });
    expect(adjusted.statusCode, adjusted.body).toBe(201);
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, lea, Q2)).statusCode).toBe(200);
    const statement = await team.statementOf(lea, Q2);
    await team.app.modules.payroll.jobs.issueInvoices(CommissionStatementIdSchema.parse(statement.id), quiet);
    const invoice = await invoiceOf(lea, 'invoice', Q2);
    const credit = await invoiceOf(lea, 'credit_note', Q2);
    const firstInvoice = await invoiceOf(lea);

    // Under Q2, the documents its statement issued, the credit note printing the quinzaine it corrects and leading to
    // the statement that owed it; under Q1, not it.
    const second = await documents(team.owner, `period=${Q2}`);
    // Issued the same day, the credit note after the invoice: the higher number first.
    expect(
      second.documents.map((one) => [one.id, one.kind, one.period, one.statementId, one.statementPeriod]),
    ).toEqual([
      [credit.id, 'credit_note', Q1, statement.id, Q2],
      [invoice.id, 'invoice', Q2, statement.id, Q2],
    ]);
    // Read without a quinzaine (the contractor's year, the due dates), the credit note still leads to Q2's statement.
    expect(
      (await documents(team.owner, `from=${today}&to=${today}&memberId=${lea.id}`)).documents.find(
        (one) => one.id === credit.id,
      )?.statementPeriod,
    ).toBe(Q2);
    expect(second.documents.find((one) => one.id === credit.id)).toMatchObject({
      creditedInvoiceId: firstInvoice.id,
      exclVatMinor: -1_200,
      settlement: null,
      due: 'open',
    });
    expect(
      (await documents(team.owner, `period=${Q1}&memberId=${lea.id}`)).documents.map((one) => one.id),
    ).toEqual([firstInvoice.id]);

    // Long past its date, the invoice is overdue and the credit note still open: it waits for a transfer, not a payment.
    clock.days = dayNumber(credit.dueOn) - dayNumber(today) + 30;
    try {
      const late = await documents(team.owner, `period=${Q2}`);
      expect(new Map(late.documents.map((one) => [one.id, one.due]))).toEqual(
        new Map([
          [credit.id, 'open'],
          [invoice.id, 'overdue'],
        ]),
      );
      expect((await documents(team.owner, 'due=soon,overdue')).documents.map((one) => one.id)).not.toContain(
        credit.id,
      );
    } finally {
      clock.days = 0;
    }

    // Q2's transfer pays its invoice and takes the credit note off: both settled, on the day of the transfer.
    const { revision, payableMinor } = await team.statementOf(lea, Q2);
    const paid = await team.call('POST', `/payroll/statements/${statement.id}/pay`, team.owner, {
      revision,
      paidOn: today,
      method: 'worldremit',
      sentMinor: payableMinor,
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(await team.app.modules.payroll.jobs.settleDocuments(lea.id)).toBe(2);
    const settled = await documents(team.owner, `period=${Q2}`);
    expect(new Map(settled.documents.map((one) => [one.id, [one.settlement, one.due]]))).toEqual(
      new Map([
        [credit.id, [{ kind: 'imputed', statementId: statement.id, on: today }, 'settled']],
        [invoice.id, [{ kind: 'paid', statementId: statement.id, on: today }, 'settled']],
      ]),
    );
  });

  it('dates a compensation by the agency day it was settled, with nothing sent', async () => {
    // Q3 earns 400 and gives back the 400 left on Léa's first invoice: a total of zero, nothing to send.
    await team.report(lea, Q3, 2_500);
    const adjusted = await team.call('POST', '/payroll/adjustments', team.owner, {
      id: newId(PayAdjustmentIdSchema),
      memberId: lea.id,
      amountMinor: -400,
      reason: 'Second remboursement de la plateforme',
      correctsStatementId: (await team.statementOf(lea, Q1)).id,
    });
    expect(adjusted.statusCode, adjusted.body).toBe(201);
    await team.recalculate(Q3);
    expect((await team.validate(team.owner, lea, Q3)).statusCode).toBe(200);
    const statement = await team.statementOf(lea, Q3);
    expect([statement.totalMinor, statement.payableMinor]).toEqual([0, 0]);
    await team.app.modules.payroll.jobs.issueInvoices(CommissionStatementIdSchema.parse(statement.id), quiet);
    expect(await team.app.modules.payroll.jobs.settleDocuments(lea.id)).toBe(2);
    const third = await documents(team.owner, `period=${Q3}`);
    expect(third.documents.map((one) => [one.kind, one.exclVatMinor, one.settlement, one.due])).toEqual([
      ['credit_note', -400, { kind: 'compensated', statementId: statement.id, on: today }, 'settled'],
      ['invoice', 400, { kind: 'compensated', statementId: statement.id, on: today }, 'settled'],
    ]);
  });

  it('gives a credit note no validation issued neither a statement nor its quinzaine, listed under the one it corrects', async () => {
    // No route issues one today (every document comes from a statement); the base allows it, as the contract says:
    // written here as an import would, on Théo's invoice, the next number of his counter.
    const invoice = await invoiceOf(theo);
    // Its line copies the kind and the words of a credit note's line the job wrote (Léa's, under Q2).
    const [model] = await team.test.admin.db
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, (await invoiceOf(lea, 'credit_note', Q2)).id));
    if (model === undefined) throw new Error('no line on Léa’s credit note');
    const year = Number(today.slice(0, 4));
    const vatMinor = Math.round((-100 * invoice.vatMinor) / invoice.exclVatMinor);
    const id = newId(InvoiceIdSchema);
    await team.test.admin.db.transaction(async (tx) => {
      // The document, its line and its event `issued`, in one transaction, as the base requires at commit.
      const counterOf = and(
        eq(schema.invoiceCounters.memberId, theo.id),
        eq(schema.invoiceCounters.year, year),
      );
      const [counter] = await tx.select().from(schema.invoiceCounters).where(counterOf).for('update');
      if (counter === undefined) throw new Error('no counter for Théo');
      const sequence = counter.lastSequence + 1;
      await tx.update(schema.invoiceCounters).set({ lastSequence: sequence }).where(counterOf);
      await tx.insert(schema.invoices).values({
        id,
        kind: 'credit_note',
        memberId: theo.id,
        statementId: null,
        creditedInvoiceId: invoice.id,
        reissuedInvoiceId: null,
        period: invoice.period,
        prefix: invoice.prefix,
        year,
        sequence,
        number: `${invoice.prefix}-${String(year)}-${String(sequence).padStart(4, '0')}`,
        idempotencyKey: `test:credit-without-statement:${invoice.id}`,
        issuedOn: today,
        dueOn: today,
        contractor: invoice.contractor,
        agency: invoice.agency,
        regimeId: invoice.regimeId,
        regime: invoice.regime,
        mentions: invoice.mentions,
        exclVatMinor: -100,
        vatMinor,
        inclVatMinor: -100 + vatMinor,
        selfAssessedVatMinor: 0,
        acceptanceDeadline: new Date(Date.now() + 15 * DAY),
      });
      await tx.insert(schema.invoiceLines).values({
        invoiceId: id,
        position: 1,
        kind: model.kind,
        label: model.label,
        detail: model.detail,
        amountMinor: -100,
      });
      await tx
        .insert(schema.invoiceEvents)
        .values({ id: newId(InvoiceEventIdSchema), invoiceId: id, kind: 'issued', by: null });
    });

    const listed = await documents(team.owner, `period=${Q1}&memberId=${theo.id}`);
    expect(listed.documents.find((one) => one.id === id)).toMatchObject({
      kind: 'credit_note',
      period: Q1,
      statementId: null,
      statementPeriod: null,
      creditedInvoiceId: invoice.id,
    });
  });
});
