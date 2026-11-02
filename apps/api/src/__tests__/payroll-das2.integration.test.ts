import {
  BillingRegimeIdSchema,
  calendarDayAt,
  CommissionStatementIdSchema,
  ContractorRegimeIdSchema,
  Das2ExportSchema,
  PayPeriodSchema,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';
import { inventedLogo } from '../modules/invoicing/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const Q1 = PayPeriodSchema.parse('2025-05-01');
const quiet = { warn: () => undefined, error: () => undefined };

/** An amount as the file writes it: euros with a decimal comma. */
const euros = (minor: number): string =>
  `${String(Math.trunc(minor / 100))},${String(minor % 100).padStart(2, '0')}`;

describe('Équipe › Factures : le récapitulatif DAS2 (EQ-06 lot 7c)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let nina: TeamMember;
  let basile: TeamMember;
  let monaCookie: string;
  let today: string;
  let year: number;

  const das2 = (cookie: string, of: number | string = year) =>
    team.call('GET', `/payroll/accounting/das2?year=${String(of)}`, cookie);

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
    await team.app.modules.invoicing.jobs.issueInvoices(id, quiet);
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
    year = Number(today.slice(0, 4));
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: nina } = await team.addMember('nina@example.test', 'Nina'));
    ({ member: basile } = await team.addMember('basile@example.test', 'Basile'));
    ({ cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));
    const invoicing = await setUpInvoicing(team, inventedLogo(256, 64), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
      { member: basile, prefix: 'BAS', legalName: 'Basile Inventé' },
    ]);
    for (const member of [theo, lea, basile]) await invoicing.acceptMandate(member);
    // Léa under reverse charge from 2026: no VAT on the invoice.
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
    for (const member of [theo, lea, nina]) await team.report(member, Q1, 2_000_000);
    await team.report(basile, Q1, 100_000);
    await team.recalculate(Q1);
    await close(theo, 'WR-THEO');
    await close(lea, 'WR-LEA');
    await close(nina, 'WR-NINA', false);
    await close(basile, 'WR-BAS');
    // Léa moved after the invoice: the recap keeps the address it froze, and says the file changed.
    await admin
      .update(schema.contractorProfiles)
      .set({ address: '8 avenue Nouvelle, 69002 Lyon', updatedBy: lea.userId })
      .where(eq(schema.contractorProfiles.memberId, lea.id));
  });

  afterAll(() => team.close());

  it('refuses a year to come, one before 2000, and anyone but the owner, without an audit line', async () => {
    expect((await das2(team.owner, year + 1)).statusCode).toBe(400);
    expect((await das2(team.owner, 1999)).statusCode).toBe(400);
    expect((await das2(team.owner, `${String(year)}.5`)).statusCode).toBe(400);
    expect((await das2(monaCookie)).statusCode).toBe(403);
    expect(await team.audited('accounting_das2.export')).toBe(0);
  });

  it('declares who was paid over 2 400 € in the year, under the identity their invoice froze', async () => {
    const response = await das2(team.owner);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const recap = Das2ExportSchema.parse(response.json());
    const sent = async (member: TeamMember) => (await team.statementOf(member, Q1)).payableMinor;
    const [theoSent, leaSent, ninaSent, basileSent] = await Promise.all([
      sent(theo),
      sent(lea),
      sent(nina),
      sent(basile),
    ]);
    // Over the threshold the three of them, Basile under it.
    expect(Math.min(theoSent, leaSent, ninaSent)).toBeGreaterThan(240_000);
    expect(basileSent).toBeLessThanOrEqual(240_000);

    expect(recap).toMatchObject({
      year,
      fileName: `das2-prestataires_${String(year)}.csv`,
      mediaType: 'text/csv; charset=utf-8',
      notes: ['amounts_as_sent'],
    });
    expect(
      recap.beneficiaries.map((one) => [
        one.memberId,
        one.identity?.legalName ?? null,
        one.identity?.address ?? null,
        one.paidMinor,
        one.treatyExemptMinor,
        one.warnings,
      ]),
    ).toEqual([
      [lea.id, 'Léa Inventée', '3 rue Imaginaire, 69001 Lyon', leaSent, 0, ['profile_changed']],
      // Théo charges VAT on top of what the statement pays: the transfer left excluding it.
      [theo.id, 'Théo Inventé', '3 rue Imaginaire, 69001 Lyon', theoSent, 0, ['vat_charged']],
      // Nina was paid without any invoice: no identity to read, said and never taken from today.
      [nina.id, null, null, ninaSent, 0, ['identity_missing', 'transfer_without_invoice']],
    ]);

    const text = Buffer.from(recap.content, 'base64').toString('utf8');
    expect(text.startsWith('﻿')).toBe(true);
    expect(text.endsWith('\r\n')).toBe(true);
    const rows = text
      .slice(1, -2)
      .split('\r\n')
      .map((row) => row.split(';'));
    expect(rows[0]).toEqual([
      'Bénéficiaire',
      'Forme juridique',
      'Adresse',
      'Pays',
      'SIREN ou SIRET',
      'Identifiant fiscal',
      'Nature',
      'Montant versé',
      'Dont dispense conventionnelle',
      'Avertissements',
    ]);
    // Name, form, address, nature, amount, treaty part, warnings.
    expect(rows.slice(1).map((row) => [row[0], row[1], row[2], row[6], row[7], row[8], row[9]])).toEqual([
      [
        'Léa Inventée',
        'SARL',
        '3 rue Imaginaire, 69001 Lyon',
        'Commissions',
        euros(leaSent),
        '0,00',
        'dossier changé depuis la facture',
      ],
      [
        'Théo Inventé',
        'SARL',
        '3 rue Imaginaire, 69001 Lyon',
        'Commissions',
        euros(theoSent),
        '0,00',
        'TVA facturée, hors taxes versé',
      ],
      [
        '(identité absente)',
        '',
        '',
        'Commissions',
        euros(ninaSent),
        '0,00',
        'identité absente : aucune facture où la lire / virement sans facture',
      ],
    ]);

    // The year and how many, never who.
    const lines = await team.test.admin.db
      .select({ entityId: schema.auditLog.entityId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'accounting_das2.export'),
          eq(schema.auditLog.entity, 'accounting_das2'),
        ),
      );
    expect(lines).toEqual([{ entityId: String(year), details: { year, beneficiaries: 3 } }]);
  });

  it('reads a year by the days of its transfers: the year before, nobody', async () => {
    const response = await das2(team.owner, year - 1);
    expect(response.statusCode, response.body).toBe(200);
    const recap = Das2ExportSchema.parse(response.json());
    expect(recap.beneficiaries).toEqual([]);
    expect(Buffer.from(recap.content, 'base64').toString('utf8').split('\r\n')).toHaveLength(2);
  });
});
