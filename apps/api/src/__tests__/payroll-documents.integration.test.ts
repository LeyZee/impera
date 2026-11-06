import { createHash } from 'node:crypto';

import {
  BillingRegimeIdSchema,
  calendarDayAt,
  CommissionStatementIdSchema,
  ContractorDocumentIdSchema,
  ContractorDocumentSchema,
  ContractorFileSchema,
  ContractorRegimeIdSchema,
  CONTRACTOR_DOCUMENT_MAX_BYTES,
  EVENT_PAYLOADS,
  InvoiceIdSchema,
  newId,
  PayPeriodSchema,
  PayrollPeriodSchema,
  type CommissionStatementId,
  type ContractorProfileBody,
  type TeamMember,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { addDays } from '../modules/contractors/domain/billing';
import { documentRetainUntil, documentStorageKey } from '../modules/contractors/domain/documents';
import { invoicePdfRetainUntil } from '../modules/contractors/domain/retention';
import { transparentLogo } from '../modules/contractors/infra/__tests__/invented-png';
import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

/** A period of 2025: it has ended. Its invoice goes out without a certificate; its transfer waits for one (ADR 0041). */
const Q1 = PayPeriodSchema.parse('2025-05-01');
/** The agency's zone, the scheduling's default: today is its calendar day. */
const ZONE = 'Europe/Paris';
const DAY = 86_400_000;

const quiet = { warn: () => undefined, error: () => undefined };
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Invented files (ADR 0010): their first bytes say what they are, nothing more. */
const pdf = (words: string): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n% ${words}\n%%EOF\n`);
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);

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

/** An invented regime: its words are the test's, never an accountant's. */
const BENIN = {
  id: newId(BillingRegimeIdSchema),
  name: 'Bénin et Madagascar (texte inventé)',
  countries: ['BJ', 'MG'],
  vat: { treatment: 'reverse_charge', rateBps: 2_000 },
  withholding: 'treaty_exempt',
  mentions: ['Autofacturation', 'Autoliquidation'],
  documents: ['tax_residence'],
  taxIdRequired: true,
};

describe('Équipe › Pièces du prestataire : déposer, vérifier, débloquer le versement (EQ-06 lot 5c, ADR 0041)', () => {
  let team: PayrollTeam;
  let kofi: TeamMember;
  let kofiCookie: string;
  let theoCookie: string;
  let miaCookie: string;
  let statementId: string;
  const primary = createMemoryInvoiceStore();
  const copy = createMemoryInvoiceStore();

  const db = () => team.test.admin.db;
  const invoicingModule = () => team.app.modules.invoicing;
  const today = () => calendarDayAt(new Date(), ZONE);

  const upload = (cookie: string, query: Record<string, string>, bytes: Uint8Array, memberId = kofi.id) =>
    team.server.inject({
      method: 'POST',
      url: `/v1/payroll/contractors/${memberId}/documents?${new URLSearchParams(query).toString()}`,
      headers: { cookie, origin: 'http://localhost:5173', 'content-type': 'application/octet-stream' },
      payload: Buffer.from(bytes),
    });
  const download = (cookie: string, documentId: string) =>
    team.call('GET', `/payroll/contractors/${kofi.id}/documents/${documentId}/file`, cookie);
  const review = (cookie: string, documentId: string, body: object) =>
    team.call('POST', `/payroll/contractors/${kofi.id}/documents/${documentId}/review`, cookie, body);
  const residence = (issuedOn: string) => ({
    id: newId(ContractorDocumentIdSchema),
    kind: 'tax_residence',
    issuedOn,
  });

  /** Why his statement's invoice waits, as the owner is told it, in order. */
  const toldWhy = async () =>
    (
      await db()
        .select({ payload: schema.domainEvents.payload })
        .from(schema.domainEvents)
        .where(
          and(
            eq(schema.domainEvents.type, 'invoice_not_issued'),
            sql`${schema.domainEvents.payload}->>'statementId' = ${statementId}`,
          ),
        )
        .orderBy(schema.domainEvents.createdAt, schema.domainEvents.id)
    ).map((row) => EVENT_PAYLOADS.invoice_not_issued.parse(row.payload).reason);
  const requeued = async () =>
    (
      await db().execute<{ payload: unknown }>(
        sql`select payload from graphile_worker._private_jobs where key = ${`payroll.requeue_invoice_issues:${kofi.id}`}`,
      )
    ).rows.length;
  const forgetJobs = () =>
    db().execute(
      sql`delete from graphile_worker._private_jobs where key like 'payroll.requeue_invoice_issues:%'`,
    );
  const issue = () =>
    invoicingModule().jobs.issueInvoices(CommissionStatementIdSchema.parse(statementId), quiet);
  /** His statement's transfer, recorded as the owner would: `null` when recorded, else the refusal. */
  const pay = async (paidOn: string) => {
    const { revision, payableMinor } = await team.statementOf(kofi, Q1);
    const response = await team.call('POST', `/payroll/statements/${statementId}/pay`, team.owner, {
      revision,
      paidOn,
      method: 'worldremit',
      sentMinor: payableMinor,
    });
    if (response.statusCode === 200) return null;
    expect(response.statusCode, response.body).toBe(409);
    const { code, details } = team.refusal(response);
    return { code, details };
  };
  /** What stops his statement's transfer today, as the period's read shows it to `cookie`. */
  const blockOf = async (cookie: string) => {
    const response = await team.call('GET', `/payroll/periods/${Q1}`, cookie);
    expect(response.statusCode, response.body).toBe(200);
    const read = PayrollPeriodSchema.parse(response.json());
    const found = read.statements.find((one) => one.id === statementId);
    if (found === undefined) throw new Error('his statement, not read');
    return found.payoutBlock;
  };
  const lockJobs = async () =>
    (
      await db().execute<{ payload: unknown }>(
        sql`select payload from graphile_worker._private_jobs where key = ${`payroll.lock_payout_certificate:${statementId}`}`,
      )
    ).rows.map((row) => row.payload);
  const forgetLocks = () =>
    db().execute(
      sql`delete from graphile_worker._private_jobs where key like 'payroll.lock_payout_certificate:%'`,
    );
  const lockCertificates = (id: CommissionStatementId | null) =>
    team.app.modules.contractors.jobs.lockPayoutCertificates(id, quiet);

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), { invoiceBuckets: { primary, copy } });
    ({ member: kofi, cookie: kofiCookie } = await team.addMember('kofi@example.test', 'Kofi'));
    ({ cookie: theoCookie } = await team.addMember('theo@example.test', 'Théo'));
    ({ cookie: miaCookie } = await team.addMember('mia@example.test', 'Mia', 'manager'));
    await db().update(schema.teamMembers).set({ country: 'BJ' }).where(eq(schema.teamMembers.id, kofi.id));
    const invoicing = await setUpInvoicing(
      team,
      { mediaType: 'image/png', bytes: transparentLogo(480, 160) },
      [],
    );
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
    await invoicing.acceptMandate(kofi);
    expect(
      (
        await team.call('POST', `/payroll/contractors/${kofi.id}/regimes`, team.owner, {
          id: newId(ContractorRegimeIdSchema),
          regimeId: BENIN.id,
          from: today(),
        })
      ).statusCode,
    ).toBe(201);
    await team.report(kofi, Q1, 10_000);
    await team.recalculate(Q1);
    expect((await team.validate(team.owner, kofi, Q1)).statusCode).toBe(200);
    statementId = (await team.statementOf(kofi, Q1)).id;
  });

  afterAll(() => team.close());

  it('takes a PDF, a JPEG or a PNG of 10 MB at most, from the contractor or the owner, never issued ahead', async () => {
    const query = residence('2025-03-03');
    // A manager neither writes his file nor reads it (reco 10); another member does not even see him.
    const manager = await upload(miaCookie, query, pdf('a certificate'));
    expect(team.refusal(manager).code).toBe('contractor_profile_forbidden');
    const another = await upload(theoCookie, query, pdf('a certificate'));
    expect(team.refusal(another).code).toBe('team_member_not_found');
    const page = await upload(kofiCookie, query, new TextEncoder().encode('<html><script></script></html>'));
    expect(page.statusCode).toBe(400);
    expect(team.refusal(page)).toMatchObject({
      code: 'contractor_document_invalid',
      details: { reason: 'not_supported' },
    });
    const heavy = new Uint8Array(CONTRACTOR_DOCUMENT_MAX_BYTES + 1);
    heavy.set(pdf('heavy'));
    const tooHeavy = await upload(kofiCookie, query, heavy);
    expect(tooHeavy.statusCode).toBe(400);
    expect(team.refusal(tooHeavy)).toMatchObject({ details: { reason: 'too_heavy' } });
    // A tax residence certificate holds for the calendar year of its issue: no end to give.
    expect((await upload(kofiCookie, { ...query, validUntil: '2025-12-31' }, pdf('a'))).statusCode).toBe(400);
    const ahead = await upload(kofiCookie, { ...query, issuedOn: addDays(today(), 1) }, pdf('a'));
    expect(ahead.statusCode).toBe(422);
    expect(team.refusal(ahead).code).toBe('contractor_document_issued_future_unprocessable');
    expect(await db().select().from(schema.contractorDocuments)).toEqual([]);
    expect(await team.audited('contractor_document.add')).toBe(0);
  });

  it('issues his invoice under the treaty at once, and holds its transfer until a certificate of its year is accepted (ADR 0041)', async () => {
    // The invoice waits for no certificate (§ 1): issued, and nothing said to the owner.
    expect(await issue()).toMatchObject({ kind: 'planned', issued: [{ kind: 'invoice' }], notIssued: [] });
    expect(await toldWhy()).toEqual([]);

    // Its transfer waits: said on the statement before the owner makes it (§ 4), to a manager too, then refused.
    const year = today().slice(0, 4);
    expect(await blockOf(team.owner)).toEqual({ reason: 'tax_residence_missing', year });
    expect(await blockOf(miaCookie)).toEqual({ reason: 'tax_residence_missing', year });
    expect(await pay(today())).toEqual({
      code: 'payout_blocked_conflict',
      details: { reason: 'tax_residence_missing', year },
    });
    // His regime starts today: a transfer dated in 2025 needs it too, since it pays an invoice issued under the treaty.
    expect(await pay('2025-06-02')).toEqual({
      code: 'payout_blocked_conflict',
      details: { reason: 'tax_residence_missing', year: '2025' },
    });

    // A certificate of this year, filed: this year's transfer waits for the owner's check; 2025's still lacks one.
    await forgetJobs();
    const thisYear = residence(today());
    expect((await upload(kofiCookie, thisYear, JPEG)).statusCode).toBe(201);
    expect(await blockOf(team.owner)).toEqual({ reason: 'tax_residence_unverified', year });
    expect((await pay('2025-06-02'))?.details).toEqual({ reason: 'tax_residence_missing', year: '2025' });
    // No invoice waits for a certificate any more: filing one tries none again.
    expect(await requeued()).toBe(0);

    // One of 2025: filed, it waits for the owner's check.
    const of2025 = residence('2025-03-03');
    const first = pdf('certificate of 2025, first scan');
    const filed = await upload(kofiCookie, of2025, first);
    expect(filed.statusCode, filed.body).toBe(201);
    const document = ContractorDocumentSchema.parse(filed.json());
    expect(document).toMatchObject({
      id: of2025.id,
      memberId: kofi.id,
      kind: 'tax_residence',
      issuedOn: '2025-03-03',
      validUntil: null,
      lastDay: '2025-12-31',
      mediaType: 'application/pdf',
      sha256: sha256(first),
      review: null,
    });
    const key = documentStorageKey(kofi.id, of2025.id, 'application/pdf');
    const stored = primary.peek(key);
    expect(stored?.bytes).toEqual(first);
    // Locked thirty days until the check: a file refused is not kept ten years.
    const lock = stored?.retainUntil?.getTime() ?? 0;
    expect(Math.abs(lock - (Date.now() + 30 * DAY))).toBeLessThan(60_000);
    const [row] = await db()
      .select()
      .from(schema.contractorDocuments)
      .where(eq(schema.contractorDocuments.id, of2025.id));
    expect(row?.retainUntil.getTime()).toBe(lock);

    // Sent again: what was recorded; another file under its id: a conflict.
    const again = await upload(kofiCookie, of2025, first);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual(document);
    const other = await upload(kofiCookie, of2025, pdf('another file'));
    expect(other.statusCode).toBe(409);
    expect(team.refusal(other).code).toBe('contractor_document_id_conflict');

    expect((await pay('2025-06-02'))?.details).toEqual({ reason: 'tax_residence_unverified', year: '2025' });

    // He and the owner read the file, its bytes as filed; a manager does not (reco 10, 05/11), nor another member.
    const byManager = await download(miaCookie, of2025.id);
    expect(byManager.statusCode).toBe(403);
    expect(team.refusal(byManager).code).toBe('contractor_profile_forbidden');
    for (const cookie of [kofiCookie, team.owner]) {
      const read = await download(cookie, of2025.id);
      expect(read.statusCode).toBe(200);
      expect(new Uint8Array(read.rawPayload)).toEqual(first);
      expect(read.headers).toMatchObject({
        'content-type': 'application/pdf',
        'content-disposition': 'attachment; filename="tax_residence-2025-03-03.pdf"',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      });
    }
    expect((await download(theoCookie, of2025.id)).statusCode).toBe(404);

    // The owner alone checks it; a refusal says why, counts as none, and is said once.
    for (const cookie of [kofiCookie, miaCookie]) {
      expect((await review(cookie, of2025.id, { decision: 'accepted' })).statusCode).toBe(403);
    }
    const unreadable = { decision: 'refused', reason: 'L’année n’est pas lisible sur le scan.' };
    const refused = await review(team.owner, of2025.id, unreadable);
    expect(refused.statusCode, refused.body).toBe(201);
    expect(ContractorDocumentSchema.parse(refused.json()).review).toMatchObject(unreadable);
    expect((await review(team.owner, of2025.id, unreadable)).statusCode).toBe(200);
    const changed = await review(team.owner, of2025.id, { decision: 'accepted' });
    expect(changed.statusCode).toBe(409);
    expect(team.refusal(changed)).toMatchObject({
      code: 'contractor_document_reviewed_conflict',
      details: { decision: 'refused' },
    });
    // Refused, its file keeps the lock of its upload, and is never copied.
    expect(primary.peek(key)?.retainUntil?.getTime()).toBe(lock);
    expect(copy.peek(key)).toBeUndefined();
    expect((await pay('2025-06-02'))?.details).toEqual({ reason: 'tax_residence_missing', year: '2025' });
    expect(await team.audited('commission_statement.pay')).toBe(0);

    // A new scan, accepted: its file is locked as long as the invoices it may cover.
    const rescan = residence('2025-03-03');
    expect((await upload(kofiCookie, rescan, PNG)).statusCode).toBe(201);
    const accepted = await review(team.owner, rescan.id, { decision: 'accepted' });
    expect(accepted.statusCode, accepted.body).toBe(201);
    expect(ContractorDocumentSchema.parse(accepted.json()).review).toMatchObject({ decision: 'accepted' });
    const due = documentRetainUntil('2025-12-31', today(), 12);
    const rescanKey = documentStorageKey(kofi.id, rescan.id, 'image/png');
    expect(primary.peek(rescanKey)?.retainUntil).toEqual(due);
    // Accepted, it is copied to the second bucket under the same key and lock, as a PDF is (ADR 0037 § 6).
    expect(copy.peek(rescanKey)).toEqual({ bytes: PNG, retainUntil: due });
    const [check] = await db()
      .select()
      .from(schema.contractorDocumentReviews)
      .where(eq(schema.contractorDocumentReviews.documentId, rescan.id));
    expect(check).toMatchObject({
      decision: 'accepted',
      reason: null,
      retainUntil: due,
      reviewedBy: team.ownerId,
    });
    expect(await requeued()).toBe(0);

    // An invoice under a treaty keeps an accepted certificate of its year as long as itself (Bilan on #355): a shorter
    // lock is lengthened to the invoice's, in both buckets, before its PDF is stored. The refused scan and this year's
    // certificate are not its proof: their locks do not move.
    const [invoice] = await db()
      .select({ id: schema.invoices.id, issuedOn: schema.invoices.issuedOn })
      .from(schema.invoices)
      .where(eq(schema.invoices.memberId, kofi.id));
    if (invoice === undefined) throw new Error('the invoice just issued');
    const invoiceLock = invoicePdfRetainUntil(invoice.issuedOn, 12);
    for (const bucket of [primary, copy]) {
      bucket.plant(rescanKey, { bytes: PNG, retainUntil: new Date(invoiceLock.getTime() - DAY) });
    }
    const thisYearKey = documentStorageKey(kofi.id, thisYear.id, 'image/jpeg');
    const thisYearLock = primary.peek(thisYearKey)?.retainUntil;
    expect(
      await invoicingModule().jobs.renderInvoicePdf(
        InvoiceIdSchema.parse(invoice.id),
        { current: 1, max: 5 },
        quiet,
      ),
    ).toBe('stored');
    expect(primary.peek(rescanKey)?.retainUntil).toEqual(invoiceLock);
    expect(copy.peek(rescanKey)?.retainUntil).toEqual(invoiceLock);
    expect(primary.peek(key)?.retainUntil?.getTime()).toBe(lock);
    expect(primary.peek(thisYearKey)?.retainUntil).toEqual(thisYearLock);

    // This year's transfer still waits for the check of its certificate; 2025's goes, recorded with its certificate.
    expect((await pay(today()))?.details).toEqual({ reason: 'tax_residence_unverified', year });
    await forgetLocks();
    expect(await pay('2025-06-02')).toBeNull();
    expect(await blockOf(team.owner)).toBeNull();
    const [recorded] = await db()
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'commission_statement.pay'));
    expect(recorded?.details).toMatchObject({ paidOn: '2025-06-02', certificateDocumentId: rescan.id });
    expect(await lockJobs()).toEqual([{ statementId }]);

    // The certificate is kept ten years after the close of the fiscal year of the transfer, in both buckets (§ 6). A
    // lock a bucket does not name fails the run, nothing recorded; the night's run takes it again.
    const payoutLock = invoicePdfRetainUntil('2025-06-02', 12);
    const shorter = new Date(payoutLock.getTime() - DAY);
    primary.plant(rescanKey, { bytes: PNG, retainUntil: shorter });
    copy.plant(rescanKey, { bytes: PNG, retainUntil: null });
    await expect(lockCertificates(CommissionStatementIdSchema.parse(statementId))).rejects.toThrow(
      /1 certificate\(s\) not locked/u,
    );
    expect(await team.audited('commission_statement.certificate_locked')).toBe(0);
    copy.plant(rescanKey, { bytes: PNG, retainUntil: shorter });
    expect(await lockCertificates(null)).toBe(1);
    expect(primary.peek(rescanKey)?.retainUntil).toEqual(payoutLock);
    expect(copy.peek(rescanKey)?.retainUntil).toEqual(payoutLock);
    expect(await lockCertificates(null)).toBe(0);
    expect(await lockCertificates(CommissionStatementIdSchema.parse(statementId))).toBe(0);
    expect(await team.audited('commission_statement.certificate_locked')).toBe(1);

    // His file lists them, the latest filed first, each with its check.
    const file = ContractorFileSchema.parse(
      (await team.call('GET', `/payroll/contractors/${kofi.id}/file`, kofiCookie)).json(),
    );
    expect(file.documents.map((one) => [one.id, one.review?.decision ?? null])).toEqual([
      [rescan.id, 'accepted'],
      [of2025.id, 'refused'],
      [thisYear.id, null],
    ]);
    expect(await team.audited('contractor_document.add')).toBe(3);
    expect(await team.audited('contractor_document.review')).toBe(2);
  });

  it('never serves a file whose bytes are not the ones filed, records no acceptance a bucket refuses, reads the copy', async () => {
    const vigilance = { id: newId(ContractorDocumentIdSchema), kind: 'urssaf_vigilance', issuedOn: today() };
    const bytes = pdf('a vigilance certificate');
    expect((await upload(team.owner, vigilance, bytes)).statusCode).toBe(201);
    const key = documentStorageKey(kofi.id, vigilance.id, 'application/pdf');

    primary.plant(key, { bytes: pdf('altered'), retainUntil: null });
    const altered = await download(team.owner, vigilance.id);
    expect(altered.statusCode).toBe(503);
    expect(team.refusal(altered).code).toBe('contractor_document_unavailable');
    // A lock the bucket does not name is never lengthened: the check is not recorded.
    const refusedByBucket = await review(team.owner, vigilance.id, { decision: 'accepted' });
    expect(refusedByBucket.statusCode).toBe(503);
    expect(
      await db()
        .select()
        .from(schema.contractorDocumentReviews)
        .where(eq(schema.contractorDocumentReviews.documentId, vigilance.id)),
    ).toEqual([]);

    primary.plant(key, { bytes, retainUntil: new Date(Date.now() + DAY) });
    expect((await download(kofiCookie, vigilance.id)).statusCode).toBe(200);
    // The copy holds another file under its key: the acceptance is refused, nothing recorded.
    copy.plant(key, { bytes: pdf('another file'), retainUntil: new Date(Date.now() + DAY) });
    expect((await review(team.owner, vigilance.id, { decision: 'accepted' })).statusCode).toBe(503);
    const checks = () =>
      db()
        .select()
        .from(schema.contractorDocumentReviews)
        .where(eq(schema.contractorDocumentReviews.documentId, vigilance.id));
    expect(await checks()).toEqual([]);
    // The same file, left by an attempt that did not commit: its lock is lengthened like the first's, and recorded.
    copy.plant(key, { bytes, retainUntil: new Date(Date.now() + DAY) });
    expect((await review(team.owner, vigilance.id, { decision: 'accepted' })).statusCode).toBe(201);
    const [check] = await checks();
    expect(check?.retainUntil).toBeInstanceOf(Date);
    expect(primary.peek(key)?.retainUntil).toEqual(check?.retainUntil);
    expect(copy.peek(key)).toEqual({ bytes, retainUntil: check?.retainUntil });

    // Accepted, it is served from the copy when the first bucket gives another file.
    primary.plant(key, { bytes: pdf('altered'), retainUntil: null });
    const fromCopy = await download(kofiCookie, vigilance.id);
    expect(fromCopy.statusCode).toBe(200);
    expect(new Uint8Array(fromCopy.rawPayload)).toEqual(bytes);
  });
});
