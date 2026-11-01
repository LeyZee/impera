import { createHash } from 'node:crypto';

import {
  BillingRegimeIdSchema,
  CommissionStatementIdSchema,
  ContractAcceptanceIdSchema,
  ContractorRegimeIdSchema,
  ContractTextIdSchema,
  EVENT_PAYLOADS,
  newId,
  PayAdjustmentIdSchema,
  PayAdjustmentSchema,
  PayPeriodSchema,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const Q4 = PayPeriodSchema.parse('2025-06-16');

const DAY = 86_400_000;
const quiet = { warn: () => undefined, error: () => undefined };
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
const plusDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

/** Invented parties only (ADR 0010): no real name, address nor identifier. */
const AGENCY = {
  legalName: 'Agence Exemple SAS',
  address: '1 place Fictive, 69000 Lyon',
  siren: '123456789',
  vatNumber: 'FR12123456789',
};
/** The agency's payment terms, a setting: an invoice prints them after its due date. */
const TERMS =
  'Aucun escompte. Pénalités de retard au triple du taux d’intérêt légal, indemnité de 40 € pour frais de recouvrement.';
const LATER_TERMS =
  'Aucun escompte. Pénalités de retard au taux de la BCE majoré de 10 points, indemnité de 40 €.';
/** The mention of the due date, then the terms, whatever the day reads. */
const DUE_THEN = /^Échéance\u00a0: [^.]+\. /u;

describe('Équipe › Factures : l’émission à la validation d’un relevé (EQ-06 lot 3, ADR 0036)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  const regimeId = newId(BillingRegimeIdSchema);
  const mandate = {
    id: newId(ContractTextIdSchema),
    kind: 'billing_mandate',
    version: 1,
    body: 'Mandat de facturation (texte inventé pour le test). Délai de contestation : sept jours.',
    contestDelayDays: 7,
  };

  const db = () => team.test.admin.db;
  const issue = (statementId: string) =>
    team.app.modules.payroll.jobs.issueInvoices(CommissionStatementIdSchema.parse(statementId), quiet);
  const statementId = async (member: TeamMember, period: typeof Q1) =>
    (await team.statementOf(member, period)).id;

  /** The member's documents, in the order of their numbers. */
  const documentsOf = (member: TeamMember) =>
    db()
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.memberId, member.id))
      .orderBy(schema.invoices.sequence);

  const notIssued = async (statement: string) =>
    (
      await db()
        .select()
        .from(schema.domainEvents)
        .where(
          and(
            eq(schema.domainEvents.type, 'invoice_not_issued'),
            sql`${schema.domainEvents.payload}->>'statementId' = ${statement}`,
          ),
        )
        .orderBy(schema.domainEvents.id)
    ).map((row) => ({ creatorId: row.creatorId, actor: row.actor, payload: row.payload }));

  const acceptMandate = (member: TeamMember) =>
    db()
      .insert(schema.contractAcceptances)
      .values({
        id: newId(ContractAcceptanceIdSchema),
        memberId: member.id,
        textId: mandate.id,
        textSha256: sha256(mandate.body),
        acceptedBy: member.userId,
      });

  const adjust = async (member: TeamMember, amountMinor: number, corrects: typeof Q1, reason: string) => {
    const response = await team.call('POST', '/payroll/adjustments', team.owner, {
      id: newId(PayAdjustmentIdSchema),
      memberId: member.id,
      amountMinor,
      reason,
      correctsStatementId: await statementId(member, corrects),
    });
    expect(response.statusCode, response.body).toBe(201);
    return PayAdjustmentSchema.parse(response.json());
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'));
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    const admin = db();
    await admin.insert(schema.billingSettings).values({
      id: 1,
      agency: AGENCY,
      paymentTerms: TERMS,
      dueDays: 60,
      documentReminderDays: 30,
      accounts: { expense: '622', supplierPrefix: '401', vatDeductible: '44566', vatSelfAssessed: '4452' },
      updatedBy: team.ownerId,
    });
    await admin.insert(schema.billingRegimes).values({
      id: regimeId,
      name: 'France, TVA facturée',
      countries: ['FR'],
      vatTreatment: 'charged',
      vatRateBps: 2_000,
      withholding: 'none',
      mentions: ['Autofacturation'],
      documents: ['urssaf_vigilance'],
      taxIdRequired: true,
      createdBy: team.ownerId,
    });
    await admin
      .insert(schema.billingRegimeValidations)
      .values({ regimeId, validatedOn: '2025-01-01', recordedBy: team.ownerId });
    await admin
      .insert(schema.contractTexts)
      .values({ ...mandate, sha256: sha256(mandate.body), createdBy: team.ownerId });
    for (const [member, prefix, legalName] of [
      [theo, 'THEO', 'Théo Inventé'],
      [lea, 'LEA', 'Léa Inventée'],
    ] as const) {
      await admin.insert(schema.contractorRegimes).values({
        id: newId(ContractorRegimeIdSchema),
        memberId: member.id,
        regimeId,
        effectiveFrom: '2025-01-01',
        createdBy: team.ownerId,
      });
      await admin.insert(schema.contractorProfiles).values({
        memberId: member.id,
        legalName,
        address: '3 rue Imaginaire, 69001 Lyon',
        taxId: '12345678900011',
        email: `${prefix.toLowerCase()}@example.test`,
        invoicePrefix: prefix,
        updatedBy: member.userId,
      });
    }
    // Théo accepted the mandate; Léa has not yet.
    await acceptMandate(theo);
    for (const period of [Q1, Q2, Q3]) {
      await team.report(theo, period, 10_000);
      await team.report(lea, period, 10_000);
    }
    await team.recalculate(Q1);
  });

  afterAll(() => team.close());

  it('enqueues the issue in the validation, then numbers the invoice and freezes what it prints', async () => {
    expect((await team.validate(team.owner, theo, Q1)).statusCode).toBe(200);
    const id = await statementId(theo, Q1);
    const jobs = await db().execute<{ payload: unknown; max_attempts: number }>(
      sql`select payload, max_attempts from graphile_worker._private_jobs where key = ${`payroll.issue_invoices:${id}`}`,
    );
    expect(jobs.rows).toEqual([{ payload: { statementId: id }, max_attempts: 5 }]);

    const outcome = await issue(id);
    const [invoice] = await documentsOf(theo);
    if (invoice === undefined) throw new Error('no invoice');
    const year = invoice.issuedOn.slice(0, 4);
    expect(outcome).toEqual({
      kind: 'planned',
      issued: [{ kind: 'invoice', number: `THEO-${year}-0001` }],
      notIssued: [],
      // No URSSAF certificate on file: the invoice goes out, the owner is warned.
      warnings: [{ code: 'document_missing', kind: 'urssaf_vigilance' }],
    });
    const { commissionMinor } = await team.statementOf(theo, Q1);
    expect(invoice).toMatchObject({
      kind: 'invoice',
      statementId: id,
      creditedInvoiceId: null,
      period: Q1,
      prefix: 'THEO',
      sequence: 1,
      idempotencyKey: `invoice:${id}`,
      issuedBy: null,
      dueOn: plusDays(invoice.issuedOn, 60),
      contractor: {
        legalName: 'Théo Inventé',
        address: '3 rue Imaginaire, 69001 Lyon',
        country: 'FR',
        taxId: '12345678900011',
      },
      agency: AGENCY,
      regimeId,
      regime: { id: regimeId, vat: { treatment: 'charged', rateBps: 2_000 }, validatedOn: '2025-01-01' },
      // The regime's mentions, then the due date and the agency's payment terms (art. L441-9 of the Code de commerce).
      mentions: ['Autofacturation', expect.stringMatching(DUE_THEN)],
      exclVatMinor: commissionMinor,
      vatMinor: commissionMinor / 5,
      inclVatMinor: commissionMinor * 1.2,
      selfAssessedVatMinor: 0,
    });
    expect(invoice.mentions.at(-1)?.endsWith(`. ${TERMS}`)).toBe(true);
    expect(invoice.acceptanceDeadline.getTime() - invoice.issuedAt.getTime()).toBe(7 * DAY);
    const lines = await db()
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoice.id));
    expect(lines.map((line) => [line.kind, line.label, line.amountMinor])).toEqual([
      ['commission', 'Commission, compte anna-invente sur reveal', commissionMinor],
    ]);
    expect(
      await db().select().from(schema.invoiceEvents).where(eq(schema.invoiceEvents.invoiceId, invoice.id)),
    ).toEqual([expect.objectContaining({ kind: 'issued', by: null })]);
    const [audited] = await db()
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'invoice.issue'), eq(schema.auditLog.entityId, invoice.id)));
    expect(audited).toMatchObject({
      userId: null,
      details: {
        number: `THEO-${year}-0001`,
        warnings: [{ code: 'document_missing', kind: 'urssaf_vigilance' }],
      },
    });

    // A rerun (a retry, or a later enqueue) issues nothing twice.
    expect(await issue(id)).toMatchObject({ kind: 'planned', issued: [], notIssued: [] });
    expect(await documentsOf(theo)).toHaveLength(1);
  });

  it('issues nothing for a statement not validated', async () => {
    await team.report(theo, Q4, 10_000);
    await team.recalculate(Q4);
    expect(await issue(await statementId(theo, Q4))).toEqual({ kind: 'not_validated' });
    expect(await documentsOf(theo)).toHaveLength(1);
  });

  it('tells the owner once of an invoice it cannot issue, the statement staying validated', async () => {
    expect((await team.validate(team.owner, lea, Q1)).statusCode).toBe(200);
    const id = await statementId(lea, Q1);
    const outcome = await issue(id);
    const { commissionMinor, status } = await team.statementOf(lea, Q1);
    expect(outcome).toMatchObject({
      kind: 'planned',
      issued: [],
      notIssued: [{ document: 'invoice', reason: 'no_mandate', amountMinor: commissionMinor }],
    });
    expect(status).toBe('validated');
    expect(await documentsOf(lea)).toEqual([]);
    expect(await notIssued(id)).toEqual([
      {
        creatorId: null,
        actor: 'system',
        payload: EVENT_PAYLOADS.invoice_not_issued.parse({
          memberId: lea.id,
          statementId: id,
          period: Q1,
          document: 'invoice',
          reason: 'no_mandate',
          amountMinor: commissionMinor,
        }),
      },
    ]);
    expect(await team.audited('invoice.not_issued')).toBe(1);

    // Run again (a retry, or lot 5's enqueue): the same refusal is not said twice.
    expect(await issue(id)).toMatchObject({ issued: [], notIssued: [{ reason: 'no_mandate' }] });
    expect(await notIssued(id)).toHaveLength(1);
    expect(await team.audited('invoice.not_issued')).toBe(1);
  });

  it('issues the credit note an adjustment owes on the invoice of the period it corrects, in its regime', async () => {
    expect(await adjust(theo, -100, Q1, 'Vente remboursée par la plateforme')).toMatchObject({ period: Q2 });
    expect(await adjust(theo, -5_000, Q1, 'Pack remboursé deux fois')).toMatchObject({ period: Q2 });
    expect(await adjust(theo, -5_000, Q1, 'Second pack remboursé deux fois')).toMatchObject({ period: Q2 });
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, theo, Q2)).statusCode).toBe(200);
    const id = await statementId(theo, Q2);

    const outcome = await issue(id);
    const documents = await documentsOf(theo);
    const [first, invoice, note] = documents;
    if (first === undefined || invoice === undefined || note === undefined)
      throw new Error('missing documents');
    const year = first.issuedOn.slice(0, 4);
    expect(outcome).toMatchObject({
      kind: 'planned',
      issued: [
        { kind: 'invoice', number: `THEO-${year}-0002` },
        { kind: 'credit_note', number: `THEO-${year}-0003` },
      ],
      // The two others are each more than what the first half's invoice has left: never split, each said to the
      // owner, though their amounts are equal.
      notIssued: [
        { document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 5_000 },
        { document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 5_000 },
      ],
    });
    expect(note).toMatchObject({
      kind: 'credit_note',
      statementId: id,
      creditedInvoiceId: first.id,
      period: Q1,
      idempotencyKey: `credit:${id}:0`,
      regimeId: first.regimeId,
      regime: first.regime,
      mentions: [
        expect.stringMatching(new RegExp(`^Avoir sur la facture THEO-${year}-0001 du `, 'u')),
        'Autofacturation',
      ],
      exclVatMinor: -100,
      vatMinor: -20,
      inclVatMinor: -120,
    });
    const lines = await db()
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, note.id));
    expect(lines).toEqual([
      expect.objectContaining({ kind: 'adjustment', label: 'Régularisation', amountMinor: -100 }),
    ]);
    const unplaced: unknown = expect.objectContaining({
      document: 'credit_note',
      reason: 'no_invoice_to_credit',
      amountMinor: 5_000,
    });
    expect((await notIssued(id)).map((one) => one.payload)).toEqual([unplaced, unplaced]);

    // A rerun finds the same credit notes under the same keys: nothing new, and nothing said again.
    expect(await issue(id)).toMatchObject({
      issued: [],
      notIssued: [{ reason: 'no_invoice_to_credit' }, { reason: 'no_invoice_to_credit' }],
    });
    expect(await documentsOf(theo)).toHaveLength(3);
    expect(await notIssued(id)).toHaveLength(2);
  });

  it('after a partial issue, a rerun issues the very credit note that was missing, once', async () => {
    // Léa's first half has no invoice (no mandate then); her second half owes a credit note on it.
    expect(await adjust(lea, -200, Q1, 'Vente remboursée par la plateforme')).toMatchObject({ period: Q2 });
    await acceptMandate(lea);
    await team.recalculate(Q2);
    expect((await team.validate(team.owner, lea, Q2)).statusCode).toBe(200);
    const q1 = await statementId(lea, Q1);
    const q2 = await statementId(lea, Q2);
    expect(await issue(q2)).toMatchObject({
      issued: [{ kind: 'invoice' }],
      notIssued: [{ document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 200 }],
    });

    // The mandate accepted, the first half's invoice goes out (lot 5 enqueues it again), then the second half's
    // credit note on it, under the key it had.
    expect(await issue(q1)).toMatchObject({ issued: [{ kind: 'invoice' }], notIssued: [] });
    expect(await issue(q2)).toMatchObject({ issued: [{ kind: 'credit_note' }], notIssued: [] });
    expect(await issue(q2)).toMatchObject({ issued: [], notIssued: [] });
    // The missing credit note was said once, when it could not go out.
    expect(await notIssued(q2)).toHaveLength(1);
    const documents = await documentsOf(lea);
    expect(documents.map((one) => [one.kind, one.sequence, one.period, one.idempotencyKey])).toEqual([
      ['invoice', 1, Q2, `invoice:${q2}`],
      ['invoice', 2, Q1, `invoice:${q1}`],
      ['credit_note', 3, Q1, `credit:${q2}:0`],
    ]);
    expect(documents[2]?.creditedInvoiceId).toBe(documents[1]?.id);
  });

  it('numbers without a hole when one contractor’s statements issue at once', async () => {
    await team.recalculate(Q3);
    expect((await team.validate(team.owner, theo, Q3)).statusCode).toBe(200);
    expect((await team.validate(team.owner, lea, Q3)).statusCode).toBe(200);
    const theos = await statementId(theo, Q3);
    const leas = await statementId(lea, Q3);
    // Théo's Q3 and a rerun of his Q2, and Léa's Q3, all at once: the contractor's lock takes them one by one.
    await Promise.all([issue(theos), issue(await statementId(theo, Q2)), issue(leas)]);
    expect((await documentsOf(theo)).map((one) => one.sequence)).toEqual([1, 2, 3, 4]);
    expect((await documentsOf(lea)).map((one) => one.sequence)).toEqual([1, 2, 3, 4]);
    const counters = await db()
      .select()
      .from(schema.invoiceCounters)
      .orderBy(schema.invoiceCounters.memberId);
    expect(counters.map((one) => one.lastSequence)).toEqual([4, 4]);
  });

  it('prints the payment terms of the day, and an invoice issued keeps its own', async () => {
    await db().update(schema.billingSettings).set({ paymentTerms: LATER_TERMS });
    await team.recalculate(Q4);
    expect((await team.validate(team.owner, theo, Q4)).statusCode).toBe(200);
    await issue(await statementId(theo, Q4));
    const invoices = (await documentsOf(theo)).filter((one) => one.kind === 'invoice');
    const terms = invoices.map((one) => [one.period, one.mentions.at(-1)?.replace(DUE_THEN, '')]);
    // Q1 to Q3 went out under the terms of their day, frozen in their copy; Q4 prints the new ones.
    expect(terms).toEqual([
      [Q1, TERMS],
      [Q2, TERMS],
      [Q3, TERMS],
      [Q4, LATER_TERMS],
    ]);
  });
});
