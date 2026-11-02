import {
  BonusTierSetIdSchema,
  CollectiveGoalIdSchema,
  CommissionStatementIdSchema,
  newId,
  PayAdjustmentIdSchema,
  PayPeriodSchema,
  type PayPeriod,
  type TeamMember,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';
import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/**
 * The reference of ADR 0047 § 1: what pay computes and issues on a fixed scenario, written to
 * `__snapshots__/payroll-reference.json` before the payroll module is split, and found again, identical, after each
 * step of the split. Ids and the year of issue change from run to run: they are named by who they are (`theo`, `Q1`)
 * and the year is written `YYYY`. The due date follows the day of issue, so the mention writes it
 * `JJ mois AAAA` and the reference keeps the number of days between them. Every amount a statement's `inputs_hash` covers is kept, line by line.
 */

const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const quiet = { warn: () => undefined, error: () => undefined };

describe('Équipe › Paie : la référence des chiffres avant et après le découpage (ADR 0047 § 1)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  const nameOf = new Map<string, string>();
  const periodOf = new Map<string, string>();

  const db = () => team.test.admin.db;
  const label = (id: string | null): string | null => (id === null ? null : (nameOf.get(id) ?? 'unknown'));
  const statementId = async (member: TeamMember, period: PayPeriod) =>
    CommissionStatementIdSchema.parse((await team.statementOf(member, period)).id);
  const issue = async (member: TeamMember, period: PayPeriod) =>
    team.app.modules.payroll.jobs.issueInvoices(await statementId(member, period), quiet);
  const validate = async (member: TeamMember, period: PayPeriod) => {
    const response = await team.validate(team.owner, member, period);
    expect(response.statusCode, response.body).toBe(200);
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      invoiceBuckets: { primary: createMemoryInvoiceStore(), copy: createMemoryInvoiceStore() },
    });
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    nameOf.set(theo.id, 'theo');
    nameOf.set(lea.id, 'lea');
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
    ]);
    await invoicing.acceptMandate(theo);
    await invoicing.acceptMandate(lea);
    // The rules of Q1, set before it began: a tier and the team's goal.
    await db()
      .insert(schema.bonusTierSets)
      .values({
        id: newId(BonusTierSetIdSchema),
        fromPeriod: Q1,
        tiers: [{ thresholdMinor: 5_000, bonusMinor: 3_000, label: 'Bronze' }],
        createdBy: team.ownerId,
      });
    await db()
      .insert(schema.collectiveGoals)
      .values({
        id: newId(CollectiveGoalIdSchema),
        period: Q1,
        targetMinor: 10_000,
        tiers: [{ reachedBps: 5_000, bonusMinor: 1_000 }],
        createdBy: team.ownerId,
      });
    await team.report(theo, Q1, 12_345);
    await team.report(lea, Q1, 6_789);
    await team.report(lea, Q1, 1_001, { account: team.beas });
    await team.report(theo, Q2, 10_000);
    await team.report(lea, Q2, 4_321);
    await team.recalculate(Q1);
    for (const member of [theo, lea]) {
      await validate(member, Q1);
      await issue(member, Q1);
    }
    // A sale of Q1 refunded: the adjustment counts in Q2 and owes a credit note on Q1's invoice.
    const adjusted = await team.call('POST', '/payroll/adjustments', team.owner, {
      id: newId(PayAdjustmentIdSchema),
      memberId: theo.id,
      amountMinor: -250,
      reason: 'Vente remboursée par la plateforme',
      correctsStatementId: await statementId(theo, Q1),
    });
    expect(adjusted.statusCode, adjusted.body).toBe(201);
    await team.recalculate(Q2);
    for (const member of [theo, lea]) {
      await validate(member, Q2);
      await issue(member, Q2);
    }
  });

  afterAll(() => team.close());

  it('computes and issues the same figures and numbers as the reference', async () => {
    const statements = (await db().select().from(schema.commissionStatements)).sort(
      (a, b) => a.period.localeCompare(b.period) || a.netMinor - b.netMinor,
    );
    for (const one of statements) periodOf.set(one.id, `${label(one.memberId) ?? ''}@${one.period}`);
    const lines = (await db().select().from(schema.commissionStatementLines)).sort(
      (a, b) => a.grossMinor - b.grossMinor,
    );
    const invoices = (await db().select().from(schema.invoices)).sort(
      (a, b) => a.prefix.localeCompare(b.prefix) || a.sequence - b.sequence,
    );
    for (const one of invoices) nameOf.set(one.id, one.number.replace(/-\d{4}-/u, '-YYYY-'));
    const invoiceLines = (await db().select().from(schema.invoiceLines)).sort(
      (a, b) => a.position - b.position,
    );

    const reference = {
      statements: statements.map((one) => ({
        statement: periodOf.get(one.id),
        status: one.status,
        revision: one.revision,
        engineVersion: one.engineVersion,
        netMinor: one.netMinor,
        commissionMinor: one.commissionMinor,
        teamShareBaseMinor: one.teamShareBaseMinor,
        teamShareBps: one.teamShareBps,
        teamShareMinor: one.teamShareMinor,
        tierBonus: one.tierBonus,
        collectiveBonusMinor: one.collectiveBonusMinor,
        bonusesMinor: one.bonusesMinor,
        penaltiesRequestedMinor: one.penaltiesRequestedMinor,
        penaltiesMinor: one.penaltiesMinor,
        carryOversInMinor: one.carryOversInMinor,
        adjustmentsMinor: one.adjustmentsMinor,
        totalMinor: one.totalMinor,
        carryOverOutMinor: one.carryOverOutMinor,
        payableMinor: one.payableMinor,
        teamNetMinor: one.teamNetMinor,
        collective: one.collective,
        lines: lines
          .filter((line) => line.statementId === one.id && line.revision === one.revision)
          .map((line) => ({
            currency: line.currency,
            vatBps: line.vatBps,
            platformFeeBps: line.platformFeeBps,
            rateMicros: line.rateMicros,
            grossMinor: line.grossMinor,
            grossEurMinor: line.grossEurMinor,
            exclVatMinor: line.exclVatMinor,
            netMinor: line.netMinor,
            commissionMinor: line.commissionMinor,
            reports: line.shiftReportIds.length,
            lateReports: Array.isArray(line.lateReports) ? line.lateReports.length : null,
          })),
      })),
      documents: invoices.map((one) => ({
        number: nameOf.get(one.id),
        kind: one.kind,
        statement: one.statementId === null ? null : (periodOf.get(one.statementId) ?? 'unknown'),
        credits: label(one.creditedInvoiceId),
        period: one.period,
        idempotencyKey:
          one.statementId === null
            ? one.idempotencyKey
            : one.idempotencyKey.replace(one.statementId, periodOf.get(one.statementId) ?? ''),
        exclVatMinor: one.exclVatMinor,
        vatMinor: one.vatMinor,
        inclVatMinor: one.inclVatMinor,
        selfAssessedVatMinor: one.selfAssessedVatMinor,
        dueInDays: (Date.parse(one.dueOn) - Date.parse(one.issuedOn)) / 86_400_000,
        mentions: one.mentions.map((mention) =>
          mention
            .replace(/\d{4}-\d{4}( du ).*$/u, 'YYYY-NNNN$1…')
            .replace(/^(Échéance\s:\s)[^.]+\./u, '$1JJ mois AAAA.'),
        ),
        lines: invoiceLines
          .filter((line) => line.invoiceId === one.id)
          .map((line) => ({ kind: line.kind, label: line.label, amountMinor: line.amountMinor })),
      })),
    };
    await expect(`${JSON.stringify(reference, null, 2)}\n`).toMatchFileSnapshot(
      '__snapshots__/payroll-reference.json',
    );
    // The scenario is not empty: two periods of two members, invoices and a credit note.
    expect(reference.statements).toHaveLength(4);
    expect(reference.documents.map((one) => one.kind)).toContain('credit_note');
    expect(await db().select().from(schema.invoices).where(eq(schema.invoices.kind, 'invoice'))).toHaveLength(
      4,
    );
  });
});
