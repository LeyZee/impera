import {
  AccountingJournalSchema,
  BillingRegimeIdSchema,
  BillingSettingsViewSchema,
  calendarDayAt,
  CommissionStatementIdSchema,
  ContractorRegimeIdSchema,
  PayPeriodSchema,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';
import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const Q1 = PayPeriodSchema.parse('2025-05-01');
const quiet = { warn: () => undefined, error: () => undefined };

/** The accountant's accounts and journals: invented for the test. */
const ACCOUNTS = {
  expense: '622600',
  supplier: '401',
  vatDeductible: '445660',
  vatSelfAssessedDeductible: '445662',
  vatSelfAssessedDue: '445200',
  bank: '512000',
  purchaseJournal: 'HA',
  bankJournal: 'BQ',
};

/** An amount as the file writes it: euros with a decimal comma, « 0,00 » in the column it is not in. */
const euros = (minor: number): string =>
  `${String(Math.trunc(minor / 100))},${String(minor % 100).padStart(2, '0')}`;

describe('Équipe › Factures : le journal du comptable (EQ-06 lot 7b)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let nina: TeamMember;
  let monaCookie: string;
  let today: string;

  const journal = (cookie: string, from = today, to = today) =>
    team.call('GET', `/payroll/accounting/journal?from=${from}&to=${to}`, cookie);
  const setAccounts = (body: Record<string, string | null>, cookie = team.owner) =>
    team.call('PUT', '/payroll/billing-settings/accounts', cookie, body);

  /** Validates the member's statement of Q1, issues its documents unless `issue` is false, then pays it today. */
  const close = async (member: TeamMember, reference: string, issue = true) => {
    expect((await team.validate(team.owner, member, Q1)).statusCode).toBe(200);
    const statement = await team.statementOf(member, Q1);
    const id = CommissionStatementIdSchema.parse(statement.id);
    if (!issue) {
      // A transfer recorded before pay waited for its invoice (ADR 0041), as a base of before may hold one.
      await team.test.admin.db
        .update(schema.commissionStatements)
        .set({
          status: 'paid',
          paidAt: new Date(),
          paidBy: team.ownerId,
          paidOn: today,
          paymentMethod: 'worldremit',
          paymentReference: reference,
          sentMinor: statement.payableMinor,
        })
        .where(eq(schema.commissionStatements.id, id));
      return;
    }
    await team.app.modules.payroll.jobs.issueInvoices(id, quiet);
    const { revision, payableMinor } = await team.statementOf(member, Q1);
    const paid = await team.call('POST', `/payroll/statements/${id}/pay`, team.owner, {
      revision,
      paidOn: today,
      method: 'worldremit',
      reference,
      sentMinor: payableMinor,
    });
    expect(paid.statusCode, paid.body).toBe(200);
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      invoiceBuckets: { primary: createMemoryInvoiceStore(), copy: createMemoryInvoiceStore() },
    });
    today = calendarDayAt(new Date(), 'Europe/Paris');
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: nina } = await team.addMember('nina@example.test', 'Nina'));
    ({ cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));
    // A logo the settings accept (sides of 64 pixels at least), since this test reads them back.
    const invoicing = await setUpInvoicing(team, inventedLogo(256, 64), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
    ]);
    await invoicing.acceptMandate(theo);
    await invoicing.acceptMandate(lea);
    // Léa under reverse charge from 2026: no VAT on her invoice, the agency deducts and owes it.
    const reverse = BillingRegimeIdSchema.parse(crypto.randomUUID());
    const admin = team.test.admin.db;
    await admin.insert(schema.billingRegimes).values({
      id: reverse,
      name: 'Autoliquidation (texte inventé pour le test)',
      countries: ['FR'],
      vatTreatment: 'reverse_charge',
      vatRateBps: 2_000,
      withholding: 'none',
      mentions: ['Autoliquidation'],
      documents: [],
      taxIdRequired: false,
      createdBy: team.ownerId,
    });
    await admin
      .insert(schema.billingRegimeValidations)
      .values({ regimeId: reverse, validatedOn: '2025-01-01', recordedBy: team.ownerId });
    await admin.insert(schema.contractorRegimes).values({
      id: ContractorRegimeIdSchema.parse(crypto.randomUUID()),
      memberId: lea.id,
      regimeId: reverse,
      effectiveFrom: '2026-01-01',
      createdBy: team.ownerId,
    });
    for (const member of [theo, lea, nina]) await team.report(member, Q1, 10_000);
    await team.recalculate(Q1);
    await close(theo, 'WR-THEO');
    await close(lea, 'WR-LEA');
    await close(nina, 'WR-NINA', false);
  });

  afterAll(() => team.close());

  it('refuses while an account or a journal is missing, and names them, without an audit line', async () => {
    expect(team.refusal(await journal(team.owner))).toEqual({
      code: 'journal_accounts_missing_unprocessable',
      details: {
        missing: [
          'expense',
          'supplier',
          'vatDeductible',
          'vatSelfAssessedDeductible',
          'vatSelfAssessedDue',
          'bank',
          'purchaseJournal',
          'bankJournal',
        ],
      },
    });
    const partial = await setAccounts({ ...ACCOUNTS, bank: null, bankJournal: null });
    expect(partial.statusCode, partial.body).toBe(200);
    expect(team.refusal(await journal(team.owner))).toEqual({
      code: 'journal_accounts_missing_unprocessable',
      details: { missing: ['bank', 'bankJournal'] },
    });
    expect(await team.audited('accounting_journal.export')).toBe(0);
    expect(await team.audited('billing_settings.accounts')).toBe(1);
  });

  it('keeps the VAT owed off the deductible accounts and the two journals apart, for the owner alone', async () => {
    expect((await setAccounts({ ...ACCOUNTS, vatSelfAssessedDue: ACCOUNTS.vatDeductible })).statusCode).toBe(
      400,
    );
    expect(
      (await setAccounts({ ...ACCOUNTS, vatSelfAssessedDue: ACCOUNTS.vatSelfAssessedDeductible })).statusCode,
    ).toBe(400);
    expect((await setAccounts({ ...ACCOUNTS, bankJournal: ACCOUNTS.purchaseJournal })).statusCode).toBe(400);
    expect((await setAccounts({ ...ACCOUNTS, bank: '512 000' })).statusCode).toBe(400);
    expect((await setAccounts(ACCOUNTS, monaCookie)).statusCode).toBe(403);
    const saved = await setAccounts(ACCOUNTS);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(BillingSettingsViewSchema.parse(saved.json()).settings?.accounts).toEqual(ACCOUNTS);
    // The same accounts again change nothing, and write nothing.
    expect((await setAccounts(ACCOUNTS)).statusCode).toBe(200);
    expect(await team.audited('billing_settings.accounts')).toBe(2);
  });

  it('exports the documents and transfers of the range, lettered when they add up', async () => {
    expect((await journal(monaCookie)).statusCode).toBe(403);
    const response = await journal(team.owner);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const exported = AccountingJournalSchema.parse(response.json());
    const day = today.replaceAll('-', '');
    expect(exported).toMatchObject({
      fileName: `journal-prestataires_${day}_${day}.txt`,
      mediaType: 'text/plain; charset=ISO-8859-15',
      entryCount: 4,
      // Théo charges VAT on top of what his statement pays: his invoice and his transfer do not add up.
      unbalanced: [{ prefix: 'THEO', period: Q1 }],
      // Nina's transfer has no document, so no supplier account: said, never written.
      transfersLeftOut: [{ memberId: nina.id, period: Q1 }],
    });

    const text = new TextDecoder('latin1').decode(Buffer.from(exported.content, 'base64'));
    expect(text.endsWith('\r\n')).toBe(true);
    const [header, ...rows] = text
      .slice(0, -2)
      .split('\r\n')
      .map((row) => row.split('\t'));
    expect(header).toHaveLength(18);
    expect(header?.[0]).toBe('JournalCode');
    expect(rows.every((row) => row.length === 18)).toBe(true);

    const leaHt = (await team.statementOf(lea, Q1)).totalMinor;
    const theoHt = (await team.statementOf(theo, Q1)).totalMinor;
    const leaVat = leaHt / 5;
    const theoVat = theoHt / 5;
    // Journal, number, account, auxiliary account, debit, credit, letter, day of the letter.
    expect(rows.map((row) => [row[0], row[2], row[4], row[6], row[11], row[12], row[13], row[14]])).toEqual([
      ['HA', '1', '622600', '', euros(leaHt), euros(0), '', ''],
      ['HA', '1', '445662', '', euros(leaVat), euros(0), '', ''],
      ['HA', '1', '445200', '', euros(0), euros(leaVat), '', ''],
      ['HA', '1', '401', '401LEA', euros(0), euros(leaHt), 'AXK', day],
      ['HA', '2', '622600', '', euros(theoHt), euros(0), '', ''],
      ['HA', '2', '445660', '', euros(theoVat), euros(0), '', ''],
      ['HA', '2', '401', '401THEO', euros(0), euros(theoHt + theoVat), '', ''],
      ['BQ', '1', '401', '401LEA', euros(leaHt), euros(0), 'AXK', day],
      ['BQ', '1', '512000', '', euros(0), euros(leaHt), '', ''],
      ['BQ', '2', '401', '401THEO', euros(theoHt), euros(0), '', ''],
      ['BQ', '2', '512000', '', euros(0), euros(theoHt), '', ''],
    ]);
    expect(rows.map((row) => [row[7], row[8], row[10]])).toContainEqual([
      'Léa Inventée',
      'WR-LEA',
      'Virement LEA, quinzaine du 1er au 15 mai 2025',
    ]);
    expect(await team.audited('accounting_journal.export')).toBe(1);
  });

  it('refuses a range the wrong way round or of two years and more', async () => {
    expect((await journal(team.owner, '2026-11-02', '2026-11-01')).statusCode).toBe(400);
    // 731 days at most, both ends included: a first fiscal year of 24 months across a 29 February.
    expect((await journal(team.owner, '2024-10-31', '2026-11-01')).statusCode).toBe(400);
    const empty = await journal(team.owner, '2024-11-01', '2026-11-01');
    expect(empty.statusCode, empty.body).toBe(200);
    expect(AccountingJournalSchema.parse(empty.json())).toMatchObject({ entryCount: 0, unbalanced: [] });
  });
});
