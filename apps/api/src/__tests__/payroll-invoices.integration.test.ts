import { createHash } from 'node:crypto';

import {
  BillingRegimeIdSchema,
  CommissionStatementIdSchema,
  ContractAcceptanceIdSchema,
  ContractorRegimeIdSchema,
  ContractTextIdSchema,
  EVENT_PAYLOADS,
  InvoiceIdSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  PayAdjustmentIdSchema,
  PayAdjustmentSchema,
  PayPeriodSchema,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createMemoryInvoiceStore } from '../modules/payroll';
import { invoicePdfKey, invoicePdfRetainUntil } from '../modules/payroll/domain/invoice-pdf';
import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

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
/** The designation of the service each invoice prints, a setting (EQ-06 lot 4). */
const SERVICE = 'Animation commerciale de comptes de créatrices (texte inventé pour le test).';
/** The agency's logo, an invented PNG. */
const LOGO = inventedLogo();
const LOGO_SHA256 = createHash('sha256').update(LOGO.bytes).digest('hex');

describe('Équipe › Factures : l’émission à la validation d’un relevé (EQ-06 lot 3, ADR 0036)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let lea: TeamMember;
  let leaCookie: string;
  /** The two buckets of the PDFs, in memory (ADR 0037 § 8). */
  const primary = createMemoryInvoiceStore();
  const copy = createMemoryInvoiceStore();
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
    team = await startPayrollTeam(inject('pgSuperuserUrl'), { invoiceBuckets: { primary, copy } });
    ({ member: theo, cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea, cookie: leaCookie } = await team.addMember('lea@example.test', 'Léa'));
    const admin = db();
    await admin.insert(schema.agencyLogos).values({
      sha256: LOGO_SHA256,
      mediaType: LOGO.mediaType,
      bytes: Buffer.from(LOGO.bytes),
      createdBy: team.ownerId,
    });
    await admin.insert(schema.billingSettings).values({
      id: 1,
      agency: AGENCY,
      paymentTerms: TERMS,
      dueDays: 60,
      serviceDescription: SERVICE,
      logoSha256: LOGO_SHA256,
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
        businessId: '12345678900011',
        vatNumber: 'FR98123456789',
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
      ['commission', 'Commission, compte @anna-invente sur Reveal', commissionMinor],
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

  it('renders the PDF of an issued invoice once, copies it, and serves it to its contractor only (lot 4)', async () => {
    const [invoice] = await documentsOf(theo);
    if (invoice === undefined) throw new Error('no invoice');
    const id = InvoiceIdSchema.parse(invoice.id);
    const pdfUrl = `/payroll/invoices/${id}/pdf`;
    const jobOf = async (task: string) =>
      (
        await db().execute<{ payload: unknown; max_attempts: number }>(
          sql`select payload, max_attempts from graphile_worker._private_jobs where key = ${`${task}:${id}`}`,
        )
      ).rows;
    const pdfJobs = team.app.modules.payroll.jobs;
    const attempt = { current: 1, max: JOB_MAX_ATTEMPTS['payroll.render_invoice_pdf'] };

    // Enqueued with the issue, in its transaction; until it runs, the PDF is « being prepared ».
    expect(await jobOf('payroll.render_invoice_pdf')).toEqual([
      { payload: { invoiceId: id }, max_attempts: JOB_MAX_ATTEMPTS['payroll.render_invoice_pdf'] },
    ]);
    const early = await team.call('GET', pdfUrl, theoCookie);
    expect(early.statusCode).toBe(404);
    expect(team.refusal(early).code).toBe('invoice_pdf_not_found');

    expect(await pdfJobs.renderInvoicePdf(id, attempt, quiet)).toBe('stored');
    const key = invoicePdfKey(id, invoice.issuedOn);
    const stored = primary.peek(key);
    if (stored === undefined) throw new Error('no PDF in the bucket');
    const retainUntil = invoicePdfRetainUntil(invoice.issuedOn, 12);
    expect(stored.retainUntil).toEqual(retainUntil);
    const text = Buffer.from(stored.bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    // The logo the invoice froze is drawn, with its transparency.
    expect(text.match(/\/Subtype\s*\/Image/gu)?.length).toBe(2);
    const fingerprint = createHash('sha256').update(stored.bytes).digest('hex');
    const [row] = await db().select().from(schema.invoicePdfs).where(eq(schema.invoicePdfs.invoiceId, id));
    expect(row).toMatchObject({ storageKey: key, sha256: fingerprint, retainUntil });
    expect(await team.audited('invoice.pdf_store')).toBe(1);
    // A rerun renders nothing again.
    expect(await pdfJobs.renderInvoicePdf(id, attempt, quiet)).toBe('already');

    // The row enqueues its copy, which carries the same bytes under the same lock.
    expect(await jobOf('payroll.mirror_invoice_pdf')).toEqual([
      { payload: { invoiceId: id }, max_attempts: JOB_MAX_ATTEMPTS['payroll.mirror_invoice_pdf'] },
    ]);
    expect(await pdfJobs.mirrorInvoicePdf(id, attempt, quiet)).toBe('copied');
    expect(copy.peek(key)).toEqual(stored);
    const copies = await db()
      .select()
      .from(schema.invoicePdfCopies)
      .where(eq(schema.invoicePdfCopies.invoiceId, id));
    expect(copies).toEqual([
      expect.objectContaining({ provider: 'ovhcloud', storageKey: key, sha256: fingerprint, retainUntil }),
    ]);
    expect(await team.audited('invoice.pdf_copy')).toBe(1);
    expect(await pdfJobs.mirrorInvoicePdf(id, attempt, quiet)).toBe('already');

    // Served to its contractor and to the owner, named after its number, never cached; not to another member.
    for (const cookie of [theoCookie, team.owner]) {
      const response = await team.call('GET', pdfUrl, cookie);
      expect(response.statusCode).toBe(200);
      expect(response.headers).toMatchObject({
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${invoice.prefix}-${invoice.issuedOn.slice(0, 4)}-0001.pdf"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      });
      expect(Buffer.compare(response.rawPayload, Buffer.from(stored.bytes))).toBe(0);
    }
    const stranger = await team.call('GET', pdfUrl, leaCookie);
    expect(stranger.statusCode).toBe(404);
    expect(team.refusal(stranger).code).toBe('invoice_not_found');
    const unknown = await team.call('GET', `/payroll/invoices/${newId(InvoiceIdSchema)}/pdf`, theoCookie);
    expect(team.refusal(unknown).code).toBe('invoice_not_found');
    expect((await team.call('GET', '/payroll/invoices/pas-un-id/pdf', theoCookie)).statusCode).toBe(400);

    // A damaged first copy is never served: the second one is, and the owner is told once.
    primary.plant(key, { bytes: new TextEncoder().encode('damaged'), retainUntil });
    const fallback = await team.call('GET', pdfUrl, theoCookie);
    expect(fallback.statusCode).toBe(200);
    expect(Buffer.compare(fallback.rawPayload, Buffer.from(stored.bytes))).toBe(0);
    const conflicts = await db()
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'invoice_pdf_conflict'));
    expect(conflicts.map((one) => one.payload)).toEqual([
      expect.objectContaining({ invoiceId: id, memberId: theo.id, place: 'primary', stage: 'download' }),
    ]);
    // Both damaged: nothing is served.
    copy.plant(key, { bytes: new TextEncoder().encode('damaged too'), retainUntil });
    const none = await team.call('GET', pdfUrl, theoCookie);
    expect(none.statusCode).toBe(503);
    expect(team.refusal(none).code).toBe('invoice_pdf_unavailable');
    primary.plant(key, stored);
    copy.plant(key, stored);
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

    // Each renders from its frozen copy (lot 4): the invoice with its statement, the credit note citing its invoice.
    for (const document of [invoice, note]) {
      const documentId = InvoiceIdSchema.parse(document.id);
      expect(
        await team.app.modules.payroll.jobs.renderInvoicePdf(documentId, { current: 1, max: 5 }, quiet),
      ).toBe('stored');
      expect(primary.peek(invoicePdfKey(documentId, document.issuedOn))).toBeDefined();
    }
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
