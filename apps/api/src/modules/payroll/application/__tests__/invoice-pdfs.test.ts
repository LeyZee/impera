import { createHash } from 'node:crypto';

import {
  InvoiceIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
  type InvoicePdfCopyProvider,
} from '@nirvana/contracts';
import { beforeEach, describe, expect, it } from 'vitest';

import { sampleInvoice } from '../../domain/__tests__/invoice-pdf-fixtures';
import { InvoiceNotFound, InvoicePdfNotFound, InvoicePdfUnavailable } from '../../domain/errors';
import { invoicePdfKey } from '../../domain/invoice-pdf';
import type {
  InvoiceObjectStore,
  InvoicePdfRenderer,
  InvoiceToRender,
  PayrollInvoicePdfStore,
  StoredInvoicePdf,
  StoredObject,
} from '../../domain/ports';
import { createMemoryInvoiceStore, type MemoryInvoiceStore } from '../../infra/invoice-buckets';
import {
  checkedInvoicePdf,
  downloadInvoicePdf,
  mirrorInvoicePdf,
  renderInvoicePdf,
  type InvoicePdfDeps,
  type JobAttempt,
} from '../invoice-pdfs';

type Alert = Parameters<PayrollInvoicePdfStore['alertUnscoped']>[0];

const quiet = { warn: () => undefined, error: () => undefined };
const FIRST: JobAttempt = { current: 1, max: 5 };
const LAST: JobAttempt = { current: 5, max: 5 };
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
/** An invoice of March 2026 under a calendar year: locked through 31 December 2036. */
const LOCK = new Date('2037-01-01T00:00:00.000Z');

const invoiceId = newId(InvoiceIdSchema);
const memberId = newId(TeamMemberIdSchema);
const reader = newId(UserIdSchema);
const stranger = newId(UserIdSchema);
const KEY = invoicePdfKey(invoiceId, '2026-03-17');

/** The PDF rows, the copies and the alerts in memory: what the Drizzle store writes, without its base. */
type FakeStore = PayrollInvoicePdfStore & {
  invoice: InvoiceToRender | null;
  readonly alerts: Alert[];
  readonly copies: { provider: InvoicePdfCopyProvider; sha256: string; retainUntil: Date }[];
};

function fakeStore(): FakeStore {
  const alerts: Alert[] = [];
  const copies: { provider: InvoicePdfCopyProvider; sha256: string; retainUntil: Date }[] = [];
  const store: FakeStore = {
    invoice: {
      id: invoiceId,
      memberId,
      number: 'AEX-2026-0021',
      issuedAt: new Date('2026-03-17T08:00:00.000Z'),
      issuedOn: '2026-03-17',
      document: sampleInvoice(),
      logo: null,
      fiscalYearEndMonth: 12,
      certificateKeys: [],
      pdf: null,
    },
    alerts,
    copies,
    toRenderUnscoped: (id: string) => Promise.resolve(id === invoiceId ? store.invoice : null),
    recordPdfUnscoped(id: string, pdf: { key: string; sha256: string; retainUntil: Date }) {
      if (store.invoice !== null && store.invoice.pdf === null && id === invoiceId) {
        store.invoice = { ...store.invoice, pdf: { ...pdf, copies: [] } };
      }
      return Promise.resolve();
    },
    recordCopyUnscoped(
      id: string,
      provider: InvoicePdfCopyProvider,
      copy: { key: string; sha256: string; retainUntil: Date },
    ) {
      const pdf = store.invoice?.pdf ?? null;
      if (store.invoice === null || pdf === null || id !== invoiceId)
        return Promise.reject(new Error('no PDF row'));
      copies.push({ provider, sha256: copy.sha256, retainUntil: copy.retainUntil });
      store.invoice = { ...store.invoice, pdf: { ...pdf, copies: [...pdf.copies, { provider, ...copy }] } };
      return Promise.resolve();
    },
    alertUnscoped(alert: Alert) {
      alerts.push(alert);
      return Promise.resolve('published' as const);
    },
    pdfFor: (userId: string, id: string) =>
      Promise.resolve(
        userId !== reader || id !== invoiceId || store.invoice === null
          ? null
          : { memberId, number: store.invoice.number, pdf: store.invoice.pdf },
      ),
  };
  return store;
}

/** A renderer that prints the document's number, or fails as told. */
type FakeRenderer = InvoicePdfRenderer & { fail: Error | null; calls: number };

function fakeRenderer(output = 'pdf AEX-2026-0021'): FakeRenderer {
  const renderer: FakeRenderer = {
    fail: null,
    calls: 0,
    render: () => {
      renderer.calls += 1;
      return renderer.fail === null ? Promise.resolve(bytesOf(output)) : Promise.reject(renderer.fail);
    },
  };
  return renderer;
}

/** A bucket that throws on every call: a provider that does not answer. */
const silent: InvoiceObjectStore = {
  volatile: false,
  writeOnce: () => Promise.reject(new Error('no answer')),
  read: () => Promise.reject(new Error('no answer')),
  lengthenLock: () => Promise.reject(new Error('no answer')),
  remove: () => Promise.reject(new Error('no answer')),
  holdsVersion: () => Promise.reject(new Error('no answer')),
};

describe('Équipe › Factures : le rendu du PDF, une fois, verrouillé (ADR 0037 § 5)', () => {
  let store: FakeStore;
  let renderer: FakeRenderer;
  let primary: MemoryInvoiceStore;
  let copy: MemoryInvoiceStore;
  const deps = () => ({ store, renderer, primary, copy });

  beforeEach(() => {
    store = fakeStore();
    renderer = fakeRenderer();
    primary = createMemoryInvoiceStore();
    copy = createMemoryInvoiceStore();
  });

  it('renders the PDF, sends it under its lock, then writes its row', async () => {
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('stored');
    const bytes = bytesOf('pdf AEX-2026-0021');
    expect(primary.peek(KEY)).toEqual({ bytes, retainUntil: LOCK });
    expect(store.invoice?.pdf).toEqual({ key: KEY, sha256: sha(bytes), retainUntil: LOCK, copies: [] });
    expect(store.alerts).toEqual([]);
  });

  it('does nothing once the row exists, and nothing for an unknown document', async () => {
    await renderInvoicePdf(deps(), invoiceId, FIRST, quiet);
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('already');
    expect(renderer.calls).toBe(1);
    expect(await renderInvoicePdf(deps(), newId(InvoiceIdSchema), FIRST, quiet)).toBe('not_found');
  });

  it('writes the row of a PDF a stopped run left, with the lock the bucket names', async () => {
    const bytes = bytesOf('pdf AEX-2026-0021');
    const posed = new Date('2037-01-01T00:00:00.000Z');
    primary.plant(KEY, { bytes, retainUntil: posed });
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('recovered');
    expect(store.invoice?.pdf).toMatchObject({ key: KEY, sha256: sha(bytes), retainUntil: posed });
  });

  it('lengthens a shorter lock found on the PDF to the one due, then writes the row with it', async () => {
    const bytes = bytesOf('pdf AEX-2026-0021');
    primary.plant(KEY, { bytes, retainUntil: new Date('2030-01-01T00:00:00.000Z') });
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('recovered');
    expect(primary.peek(KEY)?.retainUntil).toEqual(LOCK);
    expect(store.invoice?.pdf).toMatchObject({ key: KEY, sha256: sha(bytes), retainUntil: LOCK });
    expect(store.alerts).toEqual([]);
  });

  it('keeps a longer lock found on the PDF as the bucket names it', async () => {
    const longer = new Date('2040-01-01T00:00:00.000Z');
    primary.plant(KEY, { bytes: bytesOf('pdf AEX-2026-0021'), retainUntil: longer });
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('recovered');
    expect(store.invoice?.pdf?.retainUntil).toEqual(longer);
  });

  it('never records a shorter lock: a bucket that does not lengthen it fails the run, then alerts', async () => {
    const short = new Date('2030-01-01T00:00:00.000Z');
    primary.plant(KEY, { bytes: bytesOf('pdf AEX-2026-0021'), retainUntil: short });
    const refusing: MemoryInvoiceStore = {
      ...primary,
      lengthenLock: () => Promise.reject(new Error('AccessDenied')),
    };
    const stuck: MemoryInvoiceStore = { ...primary, lengthenLock: () => Promise.resolve() };
    for (const bucket of [refusing, stuck]) {
      await expect(renderInvoicePdf({ ...deps(), primary: bucket }, invoiceId, FIRST, quiet)).rejects.toThrow(
        /AccessDenied|still ends before/u,
      );
    }
    expect(store.invoice?.pdf).toBeNull();
    expect(store.alerts).toEqual([]);
    await expect(
      renderInvoicePdf({ ...deps(), primary: refusing }, invoiceId, LAST, quiet),
    ).rejects.toThrow();
    expect(store.alerts.map((alert) => alert.type)).toEqual(['invoice_pdf_missing']);
    expect(primary.peek(KEY)?.retainUntil).toEqual(short);
  });

  it('never takes an object without a lock for one under lock: the run fails and is retried', async () => {
    primary.plant(KEY, { bytes: bytesOf('pdf AEX-2026-0021'), retainUntil: null });
    await expect(renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).rejects.toThrow(/without a lock/u);
    expect(store.invoice?.pdf).toBeNull();
    expect(store.alerts).toEqual([]);
  });

  it('writes nothing and alerts the owner when the key holds another PDF', async () => {
    primary.plant(KEY, { bytes: bytesOf('another PDF'), retainUntil: LOCK });
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('conflict');
    expect(store.invoice?.pdf).toBeNull();
    expect(primary.peek(KEY)?.bytes).toEqual(bytesOf('another PDF'));
    expect(store.alerts).toEqual([
      {
        type: 'invoice_pdf_conflict',
        invoiceId,
        memberId,
        number: 'AEX-2026-0021',
        place: 'primary',
        stage: 'render',
      },
    ]);
  });

  it('reads back what another run wrote between its read and its write', async () => {
    const racing: MemoryInvoiceStore = {
      ...primary,
      async writeOnce(key, bytes, sha256, retainUntil) {
        await primary.writeOnce(key, bytes, sha256, retainUntil);
        return 'exists';
      },
    };
    expect(await renderInvoicePdf({ ...deps(), primary: racing }, invoiceId, FIRST, quiet)).toBe('recovered');
    expect(store.invoice?.pdf?.retainUntil).toEqual(LOCK);
  });

  it('alerts the owner on the last attempt only, and fails each one', async () => {
    renderer.fail = new Error('font missing');
    await expect(renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).rejects.toThrow('font missing');
    expect(store.alerts).toEqual([]);
    await expect(renderInvoicePdf(deps(), invoiceId, LAST, quiet)).rejects.toThrow('font missing');
    expect(store.alerts).toEqual([
      { type: 'invoice_pdf_missing', invoiceId, memberId, number: 'AEX-2026-0021', place: 'primary' },
    ]);
  });

  it('fails while the bucket does not answer, the job retrying', async () => {
    await expect(renderInvoicePdf({ ...deps(), primary: silent }, invoiceId, FIRST, quiet)).rejects.toThrow(
      'no answer',
    );
    expect(store.invoice?.pdf).toBeNull();
  });
});

describe('Équipe › Factures : l’attestation de résidence gardée aussi longtemps que la facture sous convention (EQ-06 lot 5c)', () => {
  const CERTIFICATE = 'contractor-documents/kofi/certificate-2026.pdf';
  const RESCAN = 'contractor-documents/kofi/certificate-2026-rescan.png';
  /** Locked at its acceptance for the invoices of the year after its last day: shorter than an invoice issued later. */
  const ACCEPTED_LOCK = new Date('2036-01-01T00:00:00.000Z');
  let store: FakeStore;
  let primary: MemoryInvoiceStore;
  let copy: MemoryInvoiceStore;
  const deps = () => ({ store, renderer: fakeRenderer(), primary, copy });
  const plantBoth = (key: string, retainUntil: Date | null) => {
    for (const bucket of [primary, copy]) bucket.plant(key, { bytes: bytesOf(key), retainUntil });
  };

  beforeEach(() => {
    store = fakeStore();
    primary = createMemoryInvoiceStore();
    copy = createMemoryInvoiceStore();
    if (store.invoice === null) throw new Error('the invoice of the fake store');
    store.invoice = { ...store.invoice, certificateKeys: [CERTIFICATE, RESCAN] };
  });

  it('lengthens each certificate’s lock to the invoice’s, in both buckets, before the PDF is stored', async () => {
    plantBoth(CERTIFICATE, ACCEPTED_LOCK);
    plantBoth(RESCAN, ACCEPTED_LOCK);
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('stored');
    for (const bucket of [primary, copy]) {
      expect(bucket.peek(CERTIFICATE)?.retainUntil).toEqual(LOCK);
      expect(bucket.peek(RESCAN)?.retainUntil).toEqual(LOCK);
    }
  });

  it('keeps a certificate’s longer lock as it is', async () => {
    const longer = new Date('2040-01-01T00:00:00.000Z');
    plantBoth(CERTIFICATE, longer);
    plantBoth(RESCAN, ACCEPTED_LOCK);
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('stored');
    expect(primary.peek(CERTIFICATE)?.retainUntil).toEqual(longer);
    expect(copy.peek(CERTIFICATE)?.retainUntil).toEqual(longer);
  });

  it('stores no PDF while a certificate is not locked as long: retried, then alerted on the last attempt', async () => {
    plantBoth(CERTIFICATE, ACCEPTED_LOCK);
    // Missing from the copy, which a locked bucket never loses: a fault, not a passing failure.
    primary.plant(RESCAN, { bytes: bytesOf(RESCAN), retainUntil: ACCEPTED_LOCK });
    await expect(renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).rejects.toThrow(/missing at ovhcloud/u);
    expect(store.invoice?.pdf).toBeNull();
    expect(primary.peek(KEY)).toBeUndefined();
    expect(store.alerts).toEqual([]);
    // No lock the bucket names: never taken for one that holds.
    copy.plant(RESCAN, { bytes: bytesOf(RESCAN), retainUntil: null });
    await expect(renderInvoicePdf(deps(), invoiceId, LAST, quiet)).rejects.toThrow(/no lock/u);
    expect(store.alerts.map((alert) => alert.type)).toEqual(['invoice_pdf_missing']);
    expect(store.invoice?.pdf).toBeNull();
  });

  it('skips a certificate a store in memory forgot with the process (development)', async () => {
    const volatilePrimary = createMemoryInvoiceStore({ volatile: true });
    const volatileCopy = createMemoryInvoiceStore({ volatile: true });
    expect(
      await renderInvoicePdf(
        { ...deps(), primary: volatilePrimary, copy: volatileCopy },
        invoiceId,
        FIRST,
        quiet,
      ),
    ).toBe('stored');
  });

  it('locks nothing for a document that relies on no certificate', async () => {
    if (store.invoice === null) throw new Error('the invoice of the fake store');
    store.invoice = { ...store.invoice, certificateKeys: [] };
    plantBoth(CERTIFICATE, ACCEPTED_LOCK);
    expect(await renderInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('stored');
    expect(primary.peek(CERTIFICATE)?.retainUntil).toEqual(ACCEPTED_LOCK);
  });
});

describe('Équipe › Factures : la copie chez le second hébergeur (ADR 0037 § 6)', () => {
  let store: FakeStore;
  let primary: MemoryInvoiceStore;
  let copy: MemoryInvoiceStore;
  const deps = () => ({ store, renderer: fakeRenderer(), primary, copy });
  const bytes = bytesOf('pdf AEX-2026-0021');

  beforeEach(async () => {
    store = fakeStore();
    primary = createMemoryInvoiceStore();
    copy = createMemoryInvoiceStore();
    await renderInvoicePdf(deps(), invoiceId, FIRST, quiet);
  });

  it('copies the bytes read back from the first bucket, same key and lock, then writes the copy’s row', async () => {
    expect(await mirrorInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('copied');
    expect(copy.peek(KEY)).toEqual({ bytes, retainUntil: LOCK });
    expect(store.copies).toEqual([{ provider: 'ovhcloud', sha256: sha(bytes), retainUntil: LOCK }]);
    expect(await mirrorInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('already');
    expect(store.copies).toHaveLength(1);
  });

  it('writes the row of a copy a stopped run left, when its bytes and lock are its PDF’s', async () => {
    copy.plant(KEY, { bytes, retainUntil: LOCK });
    expect(await mirrorInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('recovered');
    expect(store.copies).toHaveLength(1);
  });

  it('lengthens a copy found under a shorter lock to its PDF’s, then writes its row', async () => {
    copy.plant(KEY, { bytes, retainUntil: new Date('2036-01-01T00:00:00.000Z') });
    expect(await mirrorInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('recovered');
    expect(copy.peek(KEY)?.retainUntil).toEqual(LOCK);
    expect(store.copies).toEqual([{ provider: 'ovhcloud', sha256: sha(bytes), retainUntil: LOCK }]);
    expect(store.alerts).toEqual([]);
  });

  it('retries, without a conflict, a PDF a store in memory forgot with a restart (development)', async () => {
    const forgetful = createMemoryInvoiceStore({ volatile: true });
    await expect(
      mirrorInvoicePdf({ ...deps(), primary: forgetful }, invoiceId, FIRST, quiet),
    ).rejects.toThrow(/forgotten/u);
    expect(store.alerts).toEqual([]);
    expect(store.copies).toEqual([]);
  });

  const wrongCopies: [string, StoredObject][] = [
    ['other bytes', { bytes: bytesOf('another PDF'), retainUntil: LOCK }],
    ['a longer lock', { bytes, retainUntil: new Date('2038-01-01T00:00:00.000Z') }],
    ['no lock', { bytes, retainUntil: null }],
  ];
  it.each(wrongCopies)('alerts and writes nothing when the copy holds %s', async (_, planted) => {
    copy.plant(KEY, planted);
    expect(await mirrorInvoicePdf(deps(), invoiceId, FIRST, quiet)).toBe('conflict');
    expect(store.copies).toEqual([]);
    expect(store.alerts).toEqual([
      {
        type: 'invoice_pdf_conflict',
        invoiceId,
        memberId,
        number: 'AEX-2026-0021',
        place: 'ovhcloud',
        stage: 'copy',
      },
    ]);
  });

  it('copies nothing when the first bucket gives other bytes, or none', async () => {
    const damaged = createMemoryInvoiceStore();
    damaged.plant(KEY, { bytes: bytesOf('damaged'), retainUntil: LOCK });
    expect(await mirrorInvoicePdf({ ...deps(), primary: damaged }, invoiceId, FIRST, quiet)).toBe('conflict');
    expect(
      await mirrorInvoicePdf({ ...deps(), primary: createMemoryInvoiceStore() }, invoiceId, FIRST, quiet),
    ).toBe('conflict');
    expect(copy.peek(KEY)).toBeUndefined();
    expect(store.alerts.map((alert) => [alert.type, alert.place])).toEqual([
      ['invoice_pdf_conflict', 'primary'],
      ['invoice_pdf_conflict', 'primary'],
    ]);
  });

  it('fails a run without the PDF’s row, and alerts on its last attempt', async () => {
    if (store.invoice === null) throw new Error('no invoice');
    store.invoice = { ...store.invoice, pdf: null };
    await expect(mirrorInvoicePdf(deps(), invoiceId, FIRST, quiet)).rejects.toThrow(/no row/u);
    expect(store.alerts).toEqual([]);
    await expect(mirrorInvoicePdf(deps(), invoiceId, LAST, quiet)).rejects.toThrow(/no row/u);
    expect(store.alerts).toEqual([
      { type: 'invoice_pdf_missing', invoiceId, memberId, number: 'AEX-2026-0021', place: 'ovhcloud' },
    ]);
    expect(await mirrorInvoicePdf(deps(), newId(InvoiceIdSchema), FIRST, quiet)).toBe('not_found');
  });
});

describe('Équipe › Factures : le téléchargement, vérifié par l’empreinte (ADR 0037 § 7)', () => {
  let store: FakeStore;
  let primary: MemoryInvoiceStore;
  let copy: MemoryInvoiceStore;
  const deps = () => ({ store, renderer: fakeRenderer(), primary, copy });
  const bytes = bytesOf('pdf AEX-2026-0021');
  const download = (overrides: Partial<InvoicePdfDeps> = {}, userId = reader) =>
    downloadInvoicePdf({ ...deps(), ...overrides }, userId, invoiceId, quiet);

  beforeEach(async () => {
    store = fakeStore();
    primary = createMemoryInvoiceStore();
    copy = createMemoryInvoiceStore();
    await renderInvoicePdf(deps(), invoiceId, FIRST, quiet);
    await mirrorInvoicePdf(deps(), invoiceId, FIRST, quiet);
  });

  it('serves the PDF from the first bucket, named after the document’s number', async () => {
    expect(await download()).toEqual({ fileName: 'AEX-2026-0021.pdf', bytes });
  });

  it('serves the copy when the first bucket gives a wrong file, and alerts the owner', async () => {
    const damaged = createMemoryInvoiceStore();
    damaged.plant(KEY, { bytes: bytesOf('damaged'), retainUntil: LOCK });
    expect(await download({ primary: damaged })).toEqual({ fileName: 'AEX-2026-0021.pdf', bytes });
    expect(store.alerts).toEqual([
      {
        type: 'invoice_pdf_conflict',
        invoiceId,
        memberId,
        number: 'AEX-2026-0021',
        place: 'primary',
        stage: 'download',
      },
    ]);
  });

  it('serves the copy without an alert when the first bucket does not answer', async () => {
    expect(await download({ primary: silent })).toEqual({ fileName: 'AEX-2026-0021.pdf', bytes });
    expect(store.alerts).toEqual([]);
  });

  it('serves nothing, and alerts for each, when both give a wrong file', async () => {
    const damaged = createMemoryInvoiceStore();
    damaged.plant(KEY, { bytes: bytesOf('damaged'), retainUntil: LOCK });
    await expect(download({ primary: damaged, copy: damaged })).rejects.toBeInstanceOf(InvoicePdfUnavailable);
    expect(store.alerts.map((alert) => alert.place)).toEqual(['primary', 'ovhcloud']);
  });

  it('says why it gives nothing: wrong once a bucket gave a wrong file, out of reach when none answered', async () => {
    const pdf = store.invoice?.pdf ?? null;
    if (pdf === null) throw new Error('no PDF');
    const damaged = createMemoryInvoiceStore();
    damaged.plant(KEY, { bytes: bytesOf('damaged'), retainUntil: LOCK });
    const check = (buckets: Pick<InvoicePdfDeps, 'primary' | 'copy'>) =>
      checkedInvoicePdf({ store, ...buckets }, { invoiceId, memberId, number: 'AEX-2026-0021', pdf }, quiet);
    expect(await check({ primary, copy })).toEqual({ kind: 'ok', bytes });
    expect(await check({ primary: silent, copy: silent })).toEqual({ kind: 'unreachable' });
    expect(store.alerts).toEqual([]);
    // One wrong file is enough: the owner is told, and a new read would not mend it.
    expect(await check({ primary: damaged, copy: silent })).toEqual({ kind: 'wrong' });
    expect(await check({ primary: silent, copy: damaged })).toEqual({ kind: 'wrong' });
    expect(await check({ primary: damaged, copy: damaged })).toEqual({ kind: 'wrong' });
    expect(store.alerts.map((alert) => alert.place)).toEqual(['primary', 'ovhcloud', 'primary', 'ovhcloud']);
  });

  it('takes a PDF a store in memory forgot with a restart for one out of reach, never a damaged one', async () => {
    const forgetful = createMemoryInvoiceStore({ volatile: true });
    expect(await download({ primary: forgetful })).toEqual({ fileName: 'AEX-2026-0021.pdf', bytes });
    await expect(download({ primary: forgetful, copy: forgetful })).rejects.toBeInstanceOf(
      InvoicePdfUnavailable,
    );
    expect(store.alerts).toEqual([]);
    // A bucket keeps what its lock holds: an object gone from it is a wrong file, and alerts.
    expect(await download({ primary: createMemoryInvoiceStore() })).toEqual({
      fileName: 'AEX-2026-0021.pdf',
      bytes,
    });
    expect(store.alerts.map((alert) => [alert.type, alert.place])).toEqual([
      ['invoice_pdf_conflict', 'primary'],
    ]);
  });

  it('serves nothing while the first bucket fails and no copy is written yet', async () => {
    if (store.invoice?.pdf === undefined || store.invoice.pdf === null) throw new Error('no PDF');
    const pdf: StoredInvoicePdf = { ...store.invoice.pdf, copies: [] };
    store.invoice = { ...store.invoice, pdf };
    await expect(download({ primary: silent })).rejects.toBeInstanceOf(InvoicePdfUnavailable);
    await expect(download({ primary: silent, copy: silent })).rejects.toBeInstanceOf(InvoicePdfUnavailable);
  });

  it('says « not found » to a reader the document is not for, and « not ready » before the render', async () => {
    await expect(download({}, stranger)).rejects.toBeInstanceOf(InvoiceNotFound);
    if (store.invoice === null) throw new Error('no invoice');
    store.invoice = { ...store.invoice, pdf: null };
    await expect(download()).rejects.toBeInstanceOf(InvoicePdfNotFound);
  });
});
