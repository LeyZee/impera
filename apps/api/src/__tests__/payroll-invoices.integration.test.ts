import { createHash } from 'node:crypto';

import {
  BonusIdSchema,
  BonusTierSetIdSchema,
  CollectiveGoalIdSchema,
  CommissionStatementIdSchema,
  EVENT_PAYLOADS,
  InvoiceIdSchema,
  JOB_MAX_ATTEMPTS,
  newId,
  PayAdjustmentIdSchema,
  PayAdjustmentSchema,
  PayPeriodSchema,
  PayrollPeriodSchema,
  type TeamMember,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { invoicePdfRetainUntil } from '../modules/contractors/domain/retention';
import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';
import { invoicePdfKey } from '../modules/invoicing/domain/invoice-pdf';
import { inventedLogo } from '../modules/invoicing/infra/__tests__/invented-logo';

import { AGENCY, setUpInvoicing, TERMS, type Invoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** Periods of 2025: they have ended. */
const Q1 = PayPeriodSchema.parse('2025-05-01');
const Q2 = PayPeriodSchema.parse('2025-05-16');
const Q3 = PayPeriodSchema.parse('2025-06-01');
const Q4 = PayPeriodSchema.parse('2025-06-16');
const Q5 = PayPeriodSchema.parse('2025-07-01');
const Q6 = PayPeriodSchema.parse('2025-07-16');

const DAY = 86_400_000;
const quiet = { warn: () => undefined, error: () => undefined };
const plusDays = (day: string, days: number): string =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);

const LATER_TERMS =
  'Aucun escompte. Pénalités de retard au taux de la BCE majoré de 10 points, indemnité de 40 €.';
/** The mention of the due date, then the terms, whatever the day reads. */
const DUE_THEN = /^Échéance\u00a0: [^.]+\. /u;

describe('Équipe › Factures : l’émission à la validation d’un relevé (EQ-06 lot 3, ADR 0036)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;
  let theoCookie: string;
  let lea: TeamMember;
  let leaCookie: string;
  /** The two buckets of the PDFs, in memory (ADR 0037 § 8). */
  const primary = createMemoryInvoiceStore();
  const copy = createMemoryInvoiceStore();
  let invoicing: Invoicing;

  const db = () => team.test.admin.db;
  const issue = (statementId: string) =>
    team.app.modules.invoicing.jobs.issueInvoices(CommissionStatementIdSchema.parse(statementId), quiet);
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

  /** What stops the member's transfer for the period, and why, as `cookie` reads the period (recette EQP-04). */
  const heldOf = async (member: TeamMember, period: typeof Q1, cookie: string) => {
    const response = await team.call('GET', `/payroll/periods/${period}`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    const found = PayrollPeriodSchema.parse(response.json()).statements.find(
      (one) => one.memberId === member.id,
    );
    if (found === undefined) throw new Error('the statement, not read');
    return { block: found.payoutBlock, reason: found.notIssuedReason };
  };
  const held = (reason: string | null) => ({
    block: { reason: 'documents_not_issued', year: null },
    reason,
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
    invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
    ]);
    // Théo accepted the mandate; Léa has not yet.
    await invoicing.acceptMandate(theo);
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
        // A company: its form, capital and register (art. R123-237 of the Code de commerce).
        individualEntrepreneur: false,
        legalForm: 'SARL',
        shareCapitalMinor: 100_000,
        rcsCity: 'Lyon',
      },
      agency: AGENCY,
      regimeId: invoicing.regimeId,
      regime: {
        id: invoicing.regimeId,
        vat: { treatment: 'charged', rateBps: 2_000 },
        validatedOn: '2025-01-01',
      },
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
    const pdfJobs = team.app.modules.invoicing.jobs;
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
      .where(eq(schema.domainEvents.type, 'invoice_pdf_conflict'))
      .orderBy(schema.domainEvents.createdAt);
    expect(conflicts.map((one) => one.payload)).toEqual([
      expect.objectContaining({ invoiceId: id, memberId: theo.id, place: 'primary', stage: 'download' }),
    ]);
    // Both damaged: nothing is served.
    copy.plant(key, { bytes: new TextEncoder().encode('damaged too'), retainUntil });
    const none = await team.call('GET', pdfUrl, theoCookie);
    expect(none.statusCode).toBe(503);
    expect(team.refusal(none).code).toBe('invoice_pdf_unavailable');
    // The first copy, read damaged a second time, is not said again: one alert per document, place and stage.
    const again = await db()
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'invoice_pdf_conflict'))
      .orderBy(schema.domainEvents.createdAt);
    expect(again.map((one) => one.payload)).toEqual([
      expect.objectContaining({ invoiceId: id, place: 'primary', stage: 'download' }),
      expect.objectContaining({ invoiceId: id, place: 'ovhcloud', stage: 'download' }),
    ]);
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
    // Before the invoicing ran, her transfer waits for its documents, and no reason is said yet.
    expect(await heldOf(lea, Q1, team.owner)).toEqual(held(null));
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
    // Said on her statement, to the owner and to her: her mandate is what is left (recette EQP-04).
    expect(await heldOf(lea, Q1, team.owner)).toEqual(held('no_mandate'));
    expect(await heldOf(lea, Q1, leaCookie)).toEqual(held('no_mandate'));

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
        await team.app.modules.invoicing.jobs.renderInvoicePdf(documentId, { current: 1, max: 5 }, quiet),
      ).toBe('stored');
      expect(primary.peek(invoicePdfKey(documentId, document.issuedOn))).toBeDefined();
    }
  });

  it('after a partial issue, a rerun issues the very credit note that was missing, once', async () => {
    // Léa's first half has no invoice (no mandate then); her second half owes a credit note on it.
    expect(await adjust(lea, -200, Q1, 'Vente remboursée par la plateforme')).toMatchObject({ period: Q2 });
    await invoicing.acceptMandate(lea);
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

  it('credits an invoice only what its credit notes have left on it', async () => {
    // Théo's first half billed 16 €, and its credit note took 1 € off: 15 € are left. A credit note of 15,50 € no
    // longer fits on it, one of 15 € does, and nothing is left after it.
    const [first] = await documentsOf(theo);
    if (first === undefined) throw new Error('no invoice');
    expect(await adjust(theo, -1_550, Q1, 'Pack remboursé')).toMatchObject({ period: Q5 });
    expect(await adjust(theo, -1_500, Q1, 'Autre pack remboursé')).toMatchObject({ period: Q5 });
    await team.report(theo, Q5, 10_000);
    await team.recalculate(Q5);
    expect((await team.validate(team.owner, theo, Q5)).statusCode).toBe(200);
    expect(await issue(await statementId(theo, Q5))).toMatchObject({
      issued: [{ kind: 'invoice' }, { kind: 'credit_note' }],
      notIssued: [{ document: 'credit_note', reason: 'no_invoice_to_credit', amountMinor: 1_550 }],
    });
    const credits = (await documentsOf(theo)).filter((one) => one.creditedInvoiceId === first.id);
    expect(credits.map((one) => one.exclVatMinor)).toEqual([-100, -1_500]);
  });

  it('issues no invoice to a French company without its form, capital and register, then once filled and checked', async () => {
    const profile = schema.contractorProfiles;
    const company = { legalForm: 'SARL', shareCapitalMinor: 100_000, rcsCity: 'Lyon' };
    await db()
      .update(profile)
      .set({ legalForm: null, shareCapitalMinor: null, rcsCity: null })
      .where(eq(profile.memberId, lea.id));
    await team.report(lea, Q6, 10_000);
    await team.recalculate(Q6);
    expect((await team.validate(team.owner, lea, Q6)).statusCode).toBe(200);
    const id = await statementId(lea, Q6);
    const before = (await documentsOf(lea)).length;
    expect(await issue(id)).toMatchObject({
      issued: [],
      notIssued: [{ document: 'invoice', reason: 'identity_incomplete' }],
    });
    expect(await documentsOf(lea)).toHaveLength(before);
    const said = await notIssued(id);
    expect(said.map((one) => EVENT_PAYLOADS.invoice_not_issued.parse(one.payload).reason)).toEqual([
      'identity_incomplete',
    ]);

    // The file filled again: a change of identity cleared the owner's check, so nothing goes out until he checks it.
    await db().update(profile).set(company).where(eq(profile.memberId, lea.id));
    expect(await heldOf(lea, Q6, leaCookie)).toEqual(held('identity_incomplete'));
    expect(await issue(id)).toMatchObject({
      issued: [],
      notIssued: [{ document: 'invoice', reason: 'identity_unverified' }],
    });
    expect(await documentsOf(lea)).toHaveLength(before);
    // The newest reason said is the one in force: her identity now waits for the owner's check.
    expect(await heldOf(lea, Q6, team.owner)).toEqual(held('identity_unverified'));
    // Checked: the next run issues the invoice, which copies the three.
    await db()
      .update(profile)
      .set({ verifiedAt: new Date(), verifiedBy: team.ownerId, updatedBy: team.ownerId })
      .where(eq(profile.memberId, lea.id));
    expect(await issue(id)).toMatchObject({ issued: [{ kind: 'invoice' }], notIssued: [] });
    expect(
      (await notIssued(id)).map((one) => EVENT_PAYLOADS.invoice_not_issued.parse(one.payload).reason),
    ).toEqual(['identity_incomplete', 'identity_unverified']);
    // Issued: nothing stops her transfer any more, and no old reason lingers.
    expect(await heldOf(lea, Q6, leaCookie)).toEqual({ block: null, reason: null });
    const issued = (await documentsOf(lea)).at(-1);
    expect(issued?.contractor).toMatchObject({
      legalName: 'Léa Inventée',
      individualEntrepreneur: false,
      ...company,
    });
  });
});

describe('Équipe › Factures : les primes de palier et d’objectif collectif sur la facture (EQ-04, EQ-06)', () => {
  let team: PayrollTeam;
  let theo: TeamMember;

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      invoiceBuckets: { primary: createMemoryInvoiceStore(), copy: createMemoryInvoiceStore() },
    });
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    const invoicing = await setUpInvoicing(team, inventedLogo(), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
    ]);
    await invoicing.acceptMandate(theo);
  });

  afterAll(() => team.close());

  it('bills the tier, the collective and the manual bonuses the statement counted, each on its line', async () => {
    const admin = team.test.admin.db;
    // A Bronze tier at 50 € of net, and a team goal of 100 € whose half brings 10 € to each chatter.
    await admin.insert(schema.bonusTierSets).values({
      id: newId(BonusTierSetIdSchema),
      fromPeriod: Q1,
      tiers: [{ thresholdMinor: 5_000, bonusMinor: 3_000, label: 'Bronze' }],
      createdBy: team.ownerId,
    });
    await admin.insert(schema.collectiveGoals).values({
      id: newId(CollectiveGoalIdSchema),
      period: Q1,
      targetMinor: 10_000,
      tiers: [{ reachedBps: 5_000, bonusMinor: 1_000 }],
      createdBy: team.ownerId,
    });
    await team.report(theo, Q1, 12_345);
    const bonus = await team.call('POST', '/payroll/bonuses', team.owner, {
      id: newId(BonusIdSchema),
      memberId: theo.id,
      period: Q1,
      amountMinor: 2_000,
      reason: 'Renfort du samedi',
    });
    expect(bonus.statusCode, bonus.body).toBe(201);
    await team.recalculate(Q1);
    const statement = await team.statementOf(theo, Q1);
    // The three kinds of bonus in the one sum the statement keeps: the case the invoice must take apart.
    expect(statement).toMatchObject({
      tierBonus: { bonusMinor: 3_000 },
      collectiveBonusMinor: 1_000,
      bonusesMinor: 6_000,
    });
    expect((await team.validate(team.owner, theo, Q1)).statusCode).toBe(200);

    const outcome = await team.app.modules.invoicing.jobs.issueInvoices(
      CommissionStatementIdSchema.parse(statement.id),
      quiet,
    );
    expect(outcome).toMatchObject({ kind: 'planned', issued: [{ kind: 'invoice' }], notIssued: [] });
    const [invoice] = await admin.select().from(schema.invoices).where(eq(schema.invoices.memberId, theo.id));
    if (invoice === undefined) throw new Error('no invoice');
    const lines = await admin
      .select()
      .from(schema.invoiceLines)
      .where(eq(schema.invoiceLines.invoiceId, invoice.id))
      .orderBy(schema.invoiceLines.position);
    expect(lines.map((line) => [line.kind, line.amountMinor])).toEqual([
      ['commission', statement.commissionMinor],
      ['tier_bonus', 3_000],
      ['collective_bonus', 1_000],
      ['bonus', 2_000],
    ]);
    expect(invoice.exclVatMinor).toBe(statement.commissionMinor + 6_000);
  });
});
