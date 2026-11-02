import { createHash } from 'node:crypto';

import {
  calendarDayAt,
  CommissionStatementIdSchema,
  InvoiceIdSchema,
  PayPeriodSchema,
  type TeamMember,
} from '@nirvana/contracts';
import { and, eq, schema } from '@nirvana/db';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { InvoiceObjectStore } from '../modules/contractors/domain/ports';
import { invoicePdfRetainUntil } from '../modules/contractors/domain/retention';
import { createMemoryInvoiceStore } from '../modules/contractors/infra/invoice-buckets';
import { invoicePdfKey } from '../modules/payroll/domain/invoice-pdf';
import { inventedLogo } from '../modules/payroll/infra/__tests__/invented-logo';

import { setUpInvoicing } from './support/invoicing';
import { startPayrollTeam, type PayrollTeam } from './support/payroll-team';

const Q1 = PayPeriodSchema.parse('2025-05-01');
const quiet = { warn: () => undefined, error: () => undefined };
const attempt = { current: 1, max: 5 };
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
/** While `on`, neither bucket answers a read: both providers out of reach, nothing damaged. */
const outage = { on: false };
const reachable = (bucket: InvoiceObjectStore): InvoiceObjectStore => ({
  ...bucket,
  read: (key) => (outage.on ? Promise.reject(new Error('no answer')) : bucket.read(key)),
});

describe('Équipe › Factures : l’archive des PDF pour le comptable (EQ-06 lot 7d)', () => {
  const primary = createMemoryInvoiceStore();
  const copy = createMemoryInvoiceStore();
  let team: PayrollTeam;
  let theo: TeamMember;
  let lea: TeamMember;
  let nina: TeamMember;
  let monaCookie: string;
  let today: string;

  const archive = (cookie: string, from = today, to = today) =>
    team.call('GET', `/payroll/accounting/archive?from=${from}&to=${to}`, cookie);
  const invoiceOf = async (member: TeamMember) => {
    const [found] = await team.test.admin.db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.memberId, member.id));
    if (found === undefined) throw new Error('no invoice');
    return found;
  };

  beforeAll(async () => {
    team = await startPayrollTeam(inject('pgSuperuserUrl'), {
      invoiceBuckets: { primary: reachable(primary), copy: reachable(copy) },
    });
    today = calendarDayAt(new Date(), 'Europe/Paris');
    ({ member: theo } = await team.addMember('theo@example.test', 'Théo'));
    ({ member: lea } = await team.addMember('lea@example.test', 'Léa'));
    ({ member: nina } = await team.addMember('nina@example.test', 'Nina'));
    ({ cookie: monaCookie } = await team.addMember('mona@example.test', 'Mona', 'manager'));
    const invoicing = await setUpInvoicing(team, inventedLogo(256, 64), [
      { member: theo, prefix: 'THEO', legalName: 'Théo Inventé' },
      { member: lea, prefix: 'LEA', legalName: 'Léa Inventée' },
      { member: nina, prefix: 'NINA', legalName: 'Nina Inventée' },
    ]);
    for (const member of [theo, lea, nina]) {
      await invoicing.acceptMandate(member);
      await team.report(member, Q1, 10_000);
    }
    await team.recalculate(Q1);
    for (const member of [theo, lea, nina]) {
      expect((await team.validate(team.owner, member, Q1)).statusCode).toBe(200);
      const statement = await team.statementOf(member, Q1);
      await team.app.modules.payroll.jobs.issueInvoices(
        CommissionStatementIdSchema.parse(statement.id),
        quiet,
      );
    }
    // Théo's and Léa's PDFs are rendered and copied; Nina's job has not run yet.
    for (const member of [theo, lea]) {
      const id = InvoiceIdSchema.parse((await invoiceOf(member)).id);
      expect(await team.app.modules.payroll.jobs.renderInvoicePdf(id, attempt, quiet)).toBe('stored');
      expect(await team.app.modules.payroll.jobs.mirrorInvoicePdf(id, attempt, quiet)).toBe('copied');
    }
  });

  afterAll(() => team.close());

  it('refuses a range the wrong way round and anyone but the owner, without an audit line', async () => {
    expect((await archive(team.owner, '2026-11-02', '2026-11-01')).statusCode).toBe(400);
    expect((await archive(team.owner, '2024-10-31', '2026-11-01')).statusCode).toBe(400);
    expect((await archive(monaCookie)).statusCode).toBe(403);
    expect(await team.audited('accounting_archive.export')).toBe(0);
  });

  it('zips each PDF checked against its fingerprint, and says in its manifest what it could not', async () => {
    const theoInvoice = await invoiceOf(theo);
    const leaInvoice = await invoiceOf(lea);
    const ninaInvoice = await invoiceOf(nina);
    const theoKey = invoicePdfKey(InvoiceIdSchema.parse(theoInvoice.id), theoInvoice.issuedOn);
    const leaKey = invoicePdfKey(InvoiceIdSchema.parse(leaInvoice.id), leaInvoice.issuedOn);
    const theoPdf = primary.peek(theoKey);
    if (theoPdf === undefined) throw new Error('no PDF for Théo');
    const retainUntil = invoicePdfRetainUntil(theoInvoice.issuedOn, 12);
    // Théo's first copy is damaged: the archive takes the second. Léa's are both: the PDF is listed, never zipped.
    primary.plant(theoKey, { bytes: new TextEncoder().encode('damaged'), retainUntil });
    primary.plant(leaKey, { bytes: new TextEncoder().encode('damaged'), retainUntil });
    copy.plant(leaKey, { bytes: new TextEncoder().encode('damaged too'), retainUntil });

    const response = await archive(team.owner);
    expect(response.statusCode, response.body).toBe(200);
    const day = today.replaceAll('-', '');
    expect(response.headers).toMatchObject({
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="pieces-prestataires_${day}_${day}.zip"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    const files = unzipSync(new Uint8Array(response.rawPayload));
    expect(Object.keys(files)).toEqual([`${theoInvoice.number}.pdf`, 'manifeste.csv']);
    const zipped = files[`${theoInvoice.number}.pdf`];
    if (zipped === undefined) throw new Error('no PDF in the archive');
    const [theoRow] = await team.test.admin.db
      .select()
      .from(schema.invoicePdfs)
      .where(eq(schema.invoicePdfs.invoiceId, theoInvoice.id));
    expect(sha256(zipped)).toBe(theoRow?.sha256);
    expect(Buffer.compare(Buffer.from(zipped), Buffer.from(theoPdf.bytes))).toBe(0);

    const manifest = new TextDecoder('utf-8', { ignoreBOM: true }).decode(files['manifeste.csv']);
    expect(manifest.startsWith('\uFEFF')).toBe(true);
    const frenchDay = today.split('-').toReversed().join('/');
    const [leaRow] = await team.test.admin.db
      .select()
      .from(schema.invoicePdfs)
      .where(eq(schema.invoicePdfs.invoiceId, leaInvoice.id));
    // By day of issue then number: LEA, NINA, THEO.
    expect(manifest.slice(1, -2).split('\r\n')).toEqual([
      'Numéro;Nature;Émise le;Fichier;Empreinte SHA-256;État',
      `${leaInvoice.number};Facture;${frenchDay};;${leaRow?.sha256 ?? ''};PDF faux à la relecture, propriétaire alerté`,
      `${ninaInvoice.number};Facture;${frenchDay};;;PDF pas encore rendu`,
      `${theoInvoice.number};Facture;${frenchDay};${theoInvoice.number}.pdf;${theoRow?.sha256 ?? ''};archivé`,
    ]);

    // The owner is told of each damaged file, as a download would.
    const conflicts = await team.test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'invoice_pdf_conflict'))
      .orderBy(schema.domainEvents.createdAt);
    expect(conflicts.map((one) => one.payload)).toEqual([
      expect.objectContaining({ invoiceId: leaInvoice.id, place: 'primary', stage: 'download' }),
      expect.objectContaining({ invoiceId: leaInvoice.id, place: 'ovhcloud', stage: 'download' }),
      expect.objectContaining({ invoiceId: theoInvoice.id, place: 'primary', stage: 'download' }),
    ]);
    // The range and how many, never which.
    const lines = await team.test.admin.db
      .select({ entityId: schema.auditLog.entityId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'accounting_archive.export'),
          eq(schema.auditLog.entity, 'accounting_archive'),
        ),
      );
    expect(lines).toEqual([
      { entityId: `${today}/${today}`, details: { from: today, to: today, documents: 3 } },
    ]);
  });

  it('lists a PDF no bucket answers for as out of reach, to export again, without an alert', async () => {
    const theoInvoice = await invoiceOf(theo);
    const leaInvoice = await invoiceOf(lea);
    const ninaInvoice = await invoiceOf(nina);
    const conflicts = () =>
      team.test.admin.db
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.type, 'invoice_pdf_conflict'));
    const before = (await conflicts()).length;
    outage.on = true;
    const response = await archive(team.owner).finally(() => {
      outage.on = false;
    });
    expect(response.statusCode, response.body).toBe(200);
    const files = unzipSync(new Uint8Array(response.rawPayload));
    expect(Object.keys(files)).toEqual(['manifeste.csv']);
    const manifest = new TextDecoder('utf-8', { ignoreBOM: true }).decode(files['manifeste.csv']);
    const states = manifest
      .slice(1, -2)
      .split('\r\n')
      .slice(1)
      .map((line) => [line.split(';')[0], line.split(';')[3], line.split(';')[5]]);
    expect(states).toEqual([
      [leaInvoice.number, '', "hébergeurs injoignables, relancer l'export"],
      [ninaInvoice.number, '', 'PDF pas encore rendu'],
      [theoInvoice.number, '', "hébergeurs injoignables, relancer l'export"],
    ]);
    expect((await conflicts()).length).toBe(before);
  });

  it('gives a range without any document its manifest alone', async () => {
    const response = await archive(team.owner, '2025-01-01', '2025-01-31');
    expect(response.statusCode, response.body).toBe(200);
    const files = unzipSync(new Uint8Array(response.rawPayload));
    expect(Object.keys(files)).toEqual(['manifeste.csv']);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(files['manifeste.csv'])).toBe(
      '\uFEFFNuméro;Nature;Émise le;Fichier;Empreinte SHA-256;État\r\n',
    );
  });
});
