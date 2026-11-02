import {
  calendarDayAt,
  CommissionStatementIdSchema,
  ContractorFileSchema,
  ContractorRegimeIdSchema,
  BillingRegimeIdSchema,
  EventIdSchema,
  EVENT_PAYLOADS,
  newId,
  PayPeriodSchema,
  type ContractorProfileBody,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, inArray, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { addDays } from '../modules/contractors/domain/billing';
import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { lockWaits } from './support/lock-waits';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const ZONE = 'Europe/Paris';
const DAY = 86_400_000;
const quiet = { warn: () => undefined, error: () => undefined };

/** An invented contractor of Benin (ADR 0010): an individual, his IFU the test's. */
const KOFI_FILE: ContractorProfileBody = {
  legalName: 'Kofi Inventé',
  address: 'Rue imaginaire 12\nCotonou',
  taxId: '0202012345678',
  businessId: null,
  vatNumber: null,
  individualEntrepreneur: false,
  legalForm: null,
  shareCapitalMinor: null,
  rcsCity: null,
  email: 'kofi@example.test',
};

/** An invented regime under a tax treaty: its transfers wait for a tax residence certificate (ADR 0041). */
const BENIN = {
  id: newId(BillingRegimeIdSchema),
  name: 'Bénin (texte inventé)',
  countries: ['BJ'],
  vat: { treatment: 'reverse_charge', rateBps: 2_000 },
  withholding: 'treaty_exempt',
  mentions: ['Autofacturation', 'Autoliquidation'],
  documents: ['tax_residence'],
  taxIdRequired: true,
};

describe('Équipe › Factures : l’alerte avant et après l’échéance (EQ-06 lot 8)', () => {
  /** Pay's clock, moved forward by whole days to run the alert on a later day. */
  const clock = { days: 0 };
  const shifted = (): Date => new Date(Date.now() + clock.days * DAY);
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let kofi: TeamMember;
  let today: string;

  const db = () => team.test.admin.db;
  const remind = () => team.app.modules.payroll.jobs.remindDueInvoices();
  const shiftedDay = () => calendarDayAt(shifted(), ZONE);
  const invoiceOf = async (member: TeamMember) => {
    const [found] = await db()
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.kind, 'invoice'),
          eq(schema.invoices.statementId, (await team.statementOf(member, Q1)).id),
        ),
      );
    if (found === undefined) throw new Error(`no invoice for ${member.displayName}`);
    return found;
  };
  /** What the owner was told, as the events hold it, by type, in order. */
  const told = async () =>
    (
      await db()
        .select({ type: schema.domainEvents.type, payload: schema.domainEvents.payload })
        .from(schema.domainEvents)
        .where(inArray(schema.domainEvents.type, ['invoice_due_soon', 'invoice_overdue']))
        .orderBy(schema.domainEvents.createdAt, schema.domainEvents.id)
    ).map((row) =>
      row.type === 'invoice_due_soon'
        ? { type: row.type, payload: EVENT_PAYLOADS.invoice_due_soon.parse(row.payload) }
        : { type: row.type, payload: EVENT_PAYLOADS.invoice_overdue.parse(row.payload) },
    );
  const byInvoice = <T extends { readonly invoiceId: string }>(list: T[]): T[] =>
    [...list].sort((one, other) => one.invoiceId.localeCompare(other.invoiceId));
  const alertOf = async (member: TeamMember, payoutBlock: unknown) => {
    const invoice = await invoiceOf(member);
    return {
      invoiceId: invoice.id,
      memberId: member.id,
      number: invoice.number,
      dueOn: invoice.dueOn,
      inclVatMinor: invoice.inclVatMinor,
      payoutBlock,
    };
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), { payrollClock: shifted });
    today = calendarDayAt(new Date(), ZONE);
    let kofiCookie: string;
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: kofi, cookie: kofiCookie } = await team.addMember('kofi@example.test', 'Kofi'));
    await db().update(schema.teamMembers).set({ country: 'BJ' }).where(eq(schema.teamMembers.id, kofi.id));
    // Théo and Léa under « France, TVA facturée » (no treaty), due 60 days after the issue.
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
    ]);
    // Kofi under a treaty, with no certificate filed: his transfer waits (ADR 0041).
    expect((await team.call('POST', '/payroll/billing-regimes', team.owner, BENIN)).statusCode).toBe(201);
    expect(
      (
        await team.call('POST', `/payroll/billing-regimes/${BENIN.id}/validation`, team.owner, {
          validatedOn: '2025-01-01',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (await team.call('PUT', `/payroll/contractors/${kofi.id}/profile`, kofiCookie, KOFI_FILE)).statusCode,
    ).toBe(201);
    expect(
      (
        await team.call('PUT', `/payroll/contractors/${kofi.id}/profile/prefix`, team.owner, {
          invoicePrefix: 'KOFI',
        })
      ).statusCode,
    ).toBe(200);
    const file = ContractorFileSchema.parse(
      (await team.call('GET', `/payroll/contractors/${kofi.id}/file`, team.owner)).json(),
    );
    expect(
      (
        await team.call('POST', `/payroll/contractors/${kofi.id}/profile/verify`, team.owner, {
          updatedAt: file.profile?.updatedAt,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await team.call('POST', `/payroll/contractors/${kofi.id}/regimes`, team.owner, {
          id: newId(ContractorRegimeIdSchema),
          regimeId: BENIN.id,
          from: today,
        })
      ).statusCode,
    ).toBe(201);
    for (const member of [theo, lea, kofi]) {
      await invoicing.acceptMandate(member);
      await team.report(member, Q1, 10_000);
    }
    await team.recalculate(Q1);
    for (const member of [theo, lea, kofi]) {
      expect((await team.validate(team.owner, member, Q1)).statusCode).toBe(200);
      const statement = await team.statementOf(member, Q1);
      await team.app.modules.payroll.jobs.issueInvoices(
        CommissionStatementIdSchema.parse(statement.id),
        quiet,
      );
    }
    // Théo is paid today, and the reconciliation has not run yet: his invoice is settled all the same.
    const { id, revision, payableMinor } = await team.statementOf(theo, Q1);
    const paid = await team.call('POST', `/payroll/statements/${id}/pay`, team.owner, {
      revision,
      paidOn: today,
      method: 'worldremit',
      reference: 'WR-THEO',
      sentMinor: payableMinor,
    });
    expect(paid.statusCode, paid.body).toBe(200);
  });

  afterAll(() => team.close());

  it('says nothing before seven days ahead of the due date', async () => {
    for (const member of [theo, lea, kofi]) expect((await invoiceOf(member)).dueOn).toBe(addDays(today, 60));
    expect(await remind()).toBe(0);
    clock.days = 52;
    expect(await remind()).toBe(0);
    expect(await told()).toEqual([]);
    expect(await team.audited('invoice.due_alert')).toBe(0);
  });

  it('says each invoice not settled once, seven days ahead, with what stops its transfer', async () => {
    clock.days = 53;
    expect(await remind()).toBe(2);
    // Léa's transfer is free; Kofi's waits for the certificate of the year of a transfer made today. Théo was paid.
    const soon = await told();
    expect(soon.map((one) => one.type)).toEqual(['invoice_due_soon', 'invoice_due_soon']);
    expect(byInvoice(soon.map((one) => one.payload))).toEqual(
      byInvoice([
        await alertOf(lea, null),
        await alertOf(kofi, { reason: 'tax_residence_missing', year: shiftedDay().slice(0, 4) }),
      ]),
    );
    expect(await team.audited('invoice.due_alert')).toBe(2);
    // Said once: the next morning, and the one after, add nothing.
    expect(await remind()).toBe(0);
    clock.days = 54;
    expect(await remind()).toBe(0);
    expect(await told()).toHaveLength(2);
  });

  it('says it once more the day after the due date', async () => {
    // The reconciliation runs: Théo's invoice is settled in the base now, still never said.
    expect(await team.app.modules.payroll.jobs.settleDocuments(null)).toBe(1);
    clock.days = 60;
    expect(await remind()).toBe(0);
    clock.days = 61;
    expect(await remind()).toBe(2);
    const overdue = (await told()).filter((one) => one.type === 'invoice_overdue');
    expect(byInvoice(overdue.map((one) => one.payload))).toEqual(
      byInvoice([
        await alertOf(lea, null),
        await alertOf(kofi, { reason: 'tax_residence_missing', year: shiftedDay().slice(0, 4) }),
      ]),
    );
    expect(await remind()).toBe(0);
    expect(await team.audited('invoice.due_alert')).toBe(4);
  });

  it('waits for a run that is saying an invoice, then says nothing more of it', async () => {
    // A later invoice of Léa's comes due: another quinzaine, issued 53 days ago.
    clock.days = 0;
    await team.report(lea, Q2, 10_000);
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, lea, Q2)).statusCode).toBe(200);
    await team.app.modules.payroll.jobs.issueInvoices(
      CommissionStatementIdSchema.parse((await team.statementOf(lea, Q2)).id),
      quiet,
    );
    const [later] = await db()
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.statementId, (await team.statementOf(lea, Q2)).id));
    if (later === undefined) throw new Error('no invoice for Q2');
    clock.days = 53;
    // Another run holds the invoice's lock, says it, then commits: this run waits, reads it said, adds nothing.
    let release: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      held = resolve;
    });
    const other = db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`invoice_due:${later.id}`}, 0))`);
      held();
      await released;
      await tx.insert(schema.domainEvents).values({
        id: newId(EventIdSchema),
        creatorId: null,
        type: 'invoice_due_soon',
        payload: EVENT_PAYLOADS.invoice_due_soon.parse({
          invoiceId: later.id,
          memberId: lea.id,
          number: later.number,
          dueOn: later.dueOn,
          inclVatMinor: later.inclVatMinor,
          payoutBlock: null,
        }),
        actor: 'system',
        correlationId: `payroll.remind_due_invoices:${later.id}:invoice_due_soon`,
      });
    });
    await ready;
    const run = remind();
    try {
      for (let tries = 0; (await lockWaits(db())) < 1; tries += 1) {
        if (tries > 250) throw new Error('nobody waited for the lock');
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    } finally {
      release();
      await other;
    }
    expect(await run).toBe(0);
    expect((await told()).filter((one) => one.payload.invoiceId === later.id)).toHaveLength(1);
  });
});
