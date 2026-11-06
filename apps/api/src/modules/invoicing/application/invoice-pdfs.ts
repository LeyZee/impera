import type { InvoiceId, InvoicePdfCopyProvider, TeamMemberId, UserId } from '@impera/contracts';

import type { InvoiceObjectStore } from '../../contractors';
import { lockAtLeast, readChecked, sha256Hex } from '../../contractors';
import { invoicePdfRetainUntil } from '../../contractors/pure';
import type { JobLogger } from '../../contractors/pure';
import { InvoiceNotFound, InvoicePdfGone, InvoicePdfNotFound, InvoicePdfUnavailable } from '../domain/errors';
import { invoicePdfContent, invoicePdfKey } from '../domain/invoice-pdf';
import type {
  InvoicePdfRenderer,
  InvoiceToRender,
  PayrollInvoicePdfStore,
  StoredInvoicePdf,
} from '../domain/ports';

/**
 * The PDF of each issued document (EQ-06 lot 4, ADR 0037): rendered once by `payroll.render_invoice_pdf`, copied to
 * the second provider by `payroll.mirror_invoice_pdf`, and served only with its fingerprint. Neither job replaces an
 * object: a key that holds one is read back and compared, a different one alerts the owner (`invoice_pdf_conflict`).
 * A job that keeps failing alerts from its last attempt only (`invoice_pdf_missing`), never during a normal retry.
 */
export interface InvoicePdfDeps {
  readonly store: PayrollInvoicePdfStore;
  readonly renderer: InvoicePdfRenderer;
  /** The locked bucket of ADR 0028, at Hetzner. */
  readonly primary: InvoiceObjectStore;
  /** The second copy (ADR 0037 § 6), at OVHcloud. */
  readonly copy: InvoiceObjectStore;
}

/** Which attempt of its job a run is, and the job's last (`JOB_MAX_ATTEMPTS`). */
export interface JobAttempt {
  readonly current: number;
  readonly max: number;
}

/** The only provider of a copy today (`INVOICE_PDF_COPY_PROVIDERS`). */
const COPY_PROVIDER: InvoicePdfCopyProvider = 'ovhcloud';

/** A PDF's copy at `provider`, `undefined` before it is written. */
const copyAt = (
  pdf: StoredInvoicePdf,
  provider: InvoicePdfCopyProvider,
): StoredInvoicePdf['copies'][number] | undefined =>
  new Map(pdf.copies.map((one) => [one.provider, one])).get(provider);

export type RenderOutcome = 'not_found' | 'already' | 'stored' | 'recovered' | 'conflict';

/**
 * `payroll.render_invoice_pdf`: locks the tax residence certificates an invoice under a treaty relies on as long as
 * the invoice, renders the document from its frozen copy, sends it with its lock, then writes its row, which enqueues
 * the copy. Rerun, it does nothing once the row exists (the certificates were locked before it); an object without its
 * row (a run that stopped between the two) is read back: the same fingerprint writes the row with the lock read on the
 * object, another alerts and writes nothing.
 */
export async function renderInvoicePdf(
  deps: InvoicePdfDeps,
  invoiceId: InvoiceId,
  attempt: JobAttempt,
  logger: JobLogger,
): Promise<RenderOutcome> {
  const invoice = await deps.store.toRenderUnscoped(invoiceId);
  if (invoice === null) {
    logger.warn({ invoiceId }, 'payroll.render_invoice_pdf: no such document, nothing rendered');
    return 'not_found';
  }
  if (invoice.pdf !== null) return 'already';
  try {
    await lockCertificates(deps, invoice, logger);
    return await storePdf(deps, invoice, logger);
  } catch (error) {
    await alertIfLast(deps, invoice, 'primary', attempt, logger, error);
    throw error;
  }
}

/**
 * The certificates an invoice under a treaty relies on, locked in both buckets at least as long as the invoice (Bilan
 * on #355): their acceptance locked them for the invoices of the year after their last day, an invoice of their period
 * issued later (a late statement, a corrective invoice) is kept longer. Before the PDF's row, so that a run that stops
 * between the two locks them again when retried; a certificate missing from a locked bucket fails the run, retried then
 * alerted as the PDF missing (`invoice_pdf_missing`): the PDF never goes out without its proof kept as long.
 */
async function lockCertificates(
  deps: InvoicePdfDeps,
  invoice: InvoiceToRender,
  logger: JobLogger,
): Promise<void> {
  if (invoice.certificateKeys.length === 0) return;
  const due = invoicePdfRetainUntil(invoice.issuedOn, invoice.fiscalYearEndMonth);
  for (const key of invoice.certificateKeys) {
    for (const [place, bucket] of [
      ['primary', deps.primary],
      [COPY_PROVIDER, deps.copy],
    ] as const) {
      const found = await bucket.read(key);
      if (found === null) {
        // Forgotten by a store in memory (a restart in development), not lost from a locked bucket.
        if (bucket.volatile) {
          logger.warn(
            { invoiceId: invoice.id, key, place },
            'payroll.render_invoice_pdf: certificate forgotten',
          );
          continue;
        }
        throw new Error(`payroll.render_invoice_pdf: the certificate ${key} is missing at ${place}`);
      }
      if (found.retainUntil === null) {
        throw new Error(
          `payroll.render_invoice_pdf: the certificate ${key} has no lock the bucket names at ${place}`,
        );
      }
      await lockAtLeast(bucket, key, found.retainUntil, due, logger);
    }
  }
}

async function storePdf(
  deps: InvoicePdfDeps,
  invoice: InvoiceToRender,
  logger: JobLogger,
): Promise<RenderOutcome> {
  const key = invoicePdfKey(invoice.id, invoice.issuedOn);
  const bytes = await deps.renderer.render(
    invoicePdfContent(invoice.document),
    invoice.logo,
    invoice.issuedAt,
  );
  const sha256 = sha256Hex(bytes);
  // Read first (ADR 0037 § 5): a key that holds an object is never written again, whatever the bucket does with a
  // conditional write.
  const found = await deps.primary.read(key);
  if (found === null) {
    const retainUntil = invoicePdfRetainUntil(invoice.issuedOn, invoice.fiscalYearEndMonth);
    const written = await deps.primary.writeOnce(key, bytes, sha256, retainUntil);
    if (written === 'written') {
      await deps.store.recordPdfUnscoped(invoice.id, { key, sha256, retainUntil });
      return 'stored';
    }
    // Another run wrote it between the read and the write: what it wrote is read back like any object found.
    const raced = await deps.primary.read(key);
    if (raced === null) throw new Error(`payroll.render_invoice_pdf: ${key} exists but reads nothing`);
    return recover(deps, invoice, key, sha256, raced, logger);
  }
  return recover(deps, invoice, key, sha256, found, logger);
}

async function recover(
  deps: InvoicePdfDeps,
  invoice: InvoiceToRender,
  key: string,
  sha256: string,
  found: { readonly bytes: Uint8Array; readonly retainUntil: Date | null },
  logger: JobLogger,
): Promise<RenderOutcome> {
  const foundSha = sha256Hex(found.bytes);
  if (foundSha !== sha256) {
    await deps.store.alertUnscoped({
      type: 'invoice_pdf_conflict',
      invoiceId: invoice.id,
      memberId: invoice.memberId,
      number: invoice.number,
      place: 'primary',
      stage: 'render',
    });
    logger.error(
      { invoiceId: invoice.id, key, expected: sha256, found: foundSha },
      'payroll.render_invoice_pdf: the bucket holds another PDF under this key, nothing written, owner alerted',
    );
    return 'conflict';
  }
  // A lock the bucket does not name is never taken for one that holds: the run fails and is retried.
  if (found.retainUntil === null) {
    throw new Error(`payroll.render_invoice_pdf: ${key} holds the PDF without a lock the bucket names`);
  }
  const retainUntil = await lockAtLeast(
    deps.primary,
    key,
    found.retainUntil,
    invoicePdfRetainUntil(invoice.issuedOn, invoice.fiscalYearEndMonth),
    logger,
  );
  await deps.store.recordPdfUnscoped(invoice.id, { key, sha256, retainUntil });
  return 'recovered';
}

export type MirrorOutcome = 'not_found' | 'already' | 'copied' | 'recovered' | 'conflict';

/**
 * `payroll.mirror_invoice_pdf`: copies a PDF's bytes to the second provider, same key, same lock, once read back from
 * the first and checked against its row; then writes the copy's row. A copy already there with the same fingerprint
 * and lock gets its row; another one, or a first bucket that gives other bytes, alerts and writes nothing.
 */
export async function mirrorInvoicePdf(
  deps: InvoicePdfDeps,
  invoiceId: InvoiceId,
  attempt: JobAttempt,
  logger: JobLogger,
): Promise<MirrorOutcome> {
  const invoice = await deps.store.toRenderUnscoped(invoiceId);
  if (invoice === null) {
    logger.warn({ invoiceId }, 'payroll.mirror_invoice_pdf: no such document, nothing copied');
    return 'not_found';
  }
  try {
    // Enqueued with the row it copies, in one transaction: a run without the row is a fault, retried then alerted.
    if (invoice.pdf === null) throw new Error('payroll.mirror_invoice_pdf: the PDF has no row yet');
    if (copyAt(invoice.pdf, COPY_PROVIDER) !== undefined) return 'already';
    return await copyPdf(deps, invoice, invoice.pdf, logger);
  } catch (error) {
    await alertIfLast(deps, invoice, COPY_PROVIDER, attempt, logger, error);
    throw error;
  }
}

async function copyPdf(
  deps: InvoicePdfDeps,
  invoice: InvoiceToRender,
  pdf: StoredInvoicePdf,
  logger: JobLogger,
): Promise<MirrorOutcome> {
  const conflict = async (place: 'primary' | InvoicePdfCopyProvider, why: string): Promise<'conflict'> => {
    await deps.store.alertUnscoped({
      type: 'invoice_pdf_conflict',
      invoiceId: invoice.id,
      memberId: invoice.memberId,
      number: invoice.number,
      place,
      stage: 'copy',
    });
    logger.error({ invoiceId: invoice.id, key: pdf.key, place }, `payroll.mirror_invoice_pdf: ${why}`);
    return 'conflict';
  };
  const recoverCopy = async (found: {
    readonly bytes: Uint8Array;
    readonly retainUntil: Date | null;
  }): Promise<MirrorOutcome> => {
    if (sha256Hex(found.bytes) !== pdf.sha256) {
      return conflict(
        COPY_PROVIDER,
        'the copy holds other bytes under this key, nothing written, owner alerted',
      );
    }
    // A shorter lock is lengthened to its PDF's; a longer one, or none named, is not the PDF's lock and never
    // will be (a compliance lock never shortens): the owner is told.
    if (found.retainUntil === null || found.retainUntil.getTime() > pdf.retainUntil.getTime()) {
      return conflict(COPY_PROVIDER, 'the copy is not under its PDF’s lock, nothing written, owner alerted');
    }
    if (found.retainUntil.getTime() < pdf.retainUntil.getTime()) {
      const lock = await lockAtLeast(deps.copy, pdf.key, found.retainUntil, pdf.retainUntil, logger);
      if (lock.getTime() !== pdf.retainUntil.getTime()) {
        return conflict(COPY_PROVIDER, 'the copy’s lock passed its PDF’s, nothing written, owner alerted');
      }
    }
    await deps.store.recordCopyUnscoped(invoice.id, COPY_PROVIDER, {
      key: pdf.key,
      sha256: pdf.sha256,
      retainUntil: pdf.retainUntil,
    });
    return 'recovered';
  };

  const already = await deps.copy.read(pdf.key);
  if (already !== null) return recoverCopy(already);
  const source = await deps.primary.read(pdf.key);
  if (source === null) {
    // Forgotten by a store in memory (a restart in development), not lost from a locked bucket: no conflict.
    if (deps.primary.volatile) throw new Error(`payroll.mirror_invoice_pdf: ${pdf.key} was forgotten`);
    return conflict('primary', 'the PDF is missing from its bucket, nothing copied, owner alerted');
  }
  if (sha256Hex(source.bytes) !== pdf.sha256) {
    return conflict(
      'primary',
      'the PDF read back does not match its fingerprint, nothing copied, owner alerted',
    );
  }
  const written = await deps.copy.writeOnce(pdf.key, source.bytes, pdf.sha256, pdf.retainUntil);
  if (written === 'exists') {
    const raced = await deps.copy.read(pdf.key);
    if (raced === null) throw new Error(`payroll.mirror_invoice_pdf: ${pdf.key} exists but reads nothing`);
    return recoverCopy(raced);
  }
  await deps.store.recordCopyUnscoped(invoice.id, COPY_PROVIDER, {
    key: pdf.key,
    sha256: pdf.sha256,
    retainUntil: pdf.retainUntil,
  });
  return 'copied';
}

/** On the job's last attempt only: tells the owner the PDF, or its copy, is missing (ADR 0037 § 5 and § 6). */
async function alertIfLast(
  deps: InvoicePdfDeps,
  invoice: InvoiceToRender,
  place: 'primary' | InvoicePdfCopyProvider,
  attempt: JobAttempt,
  logger: JobLogger,
  error: unknown,
): Promise<void> {
  if (attempt.current < attempt.max) return;
  logger.error(
    { invoiceId: invoice.id, place, err: error },
    'invoice PDF: last attempt failed, owner alerted',
  );
  await deps.store.alertUnscoped({
    type: 'invoice_pdf_missing',
    invoiceId: invoice.id,
    memberId: invoice.memberId,
    number: invoice.number,
    place,
  });
}

/** A PDF as served: its bytes, checked against their fingerprint, and the file's name, the document's number. */
export interface DownloadedPdf {
  readonly fileName: string;
  readonly bytes: Uint8Array;
}

/** A rendered document as the base records it, to read back before it is served. */
export interface PdfToServe {
  readonly invoiceId: InvoiceId;
  readonly memberId: TeamMemberId;
  readonly number: string;
  readonly pdf: StoredInvoicePdf;
}

/**
 * A rendered PDF read back: its bytes, or why neither bucket gave them. `wrong` when a bucket gave a file unlike its
 * fingerprint (the owner is alerted), `unreachable` when no bucket answered or the copy is not written yet (nothing is
 * damaged: a later read may succeed), `forgotten` when the stores in memory of development lost it with a restart (it
 * is never rendered again, ADR 0037: recette EQP-09).
 */
export type CheckedPdf =
  | { readonly kind: 'ok'; readonly bytes: Uint8Array }
  | { readonly kind: 'wrong' | 'unreachable' | 'forgotten' };

/**
 * The bytes of a rendered PDF (ADR 0037 § 7): from the first bucket when its fingerprint matches, from the copy
 * otherwise. A wrong file alerts the owner and is never given; a bucket that does not answer falls back to the copy
 * without an alert, a passing failure not being a damaged file.
 */
export async function checkedInvoicePdf(
  deps: Pick<InvoicePdfDeps, 'store' | 'primary' | 'copy'>,
  { invoiceId, memberId, number, pdf }: PdfToServe,
  logger: JobLogger,
): Promise<CheckedPdf> {
  const wrong = async (place: 'primary' | InvoicePdfCopyProvider): Promise<void> => {
    await deps.store.alertUnscoped({
      type: 'invoice_pdf_conflict',
      invoiceId,
      memberId,
      number,
      place,
      stage: 'download',
    });
    logger.error(
      { invoiceId, place },
      'invoice PDF: a bucket gave a file unlike its fingerprint, owner alerted',
    );
  };

  const first = await readChecked(deps.primary, pdf.key, pdf.sha256);
  if (first.kind === 'ok') return first;
  if (first.kind === 'wrong') await wrong('primary');
  const copy = copyAt(pdf, COPY_PROVIDER);
  // Said wrong as soon as one bucket was: the owner has been told, and a new read would not mend it. Forgotten only
  // when no bucket can give it back any more; a bucket that did not answer may still.
  const missing = (second: 'wrong' | 'unreachable' | 'forgotten'): CheckedPdf => ({
    kind:
      first.kind === 'wrong' || second === 'wrong'
        ? 'wrong'
        : first.kind === 'forgotten' && second === 'forgotten'
          ? 'forgotten'
          : 'unreachable',
  });
  // No copy yet: it is written from the first bucket, so it is lost with it.
  if (copy === undefined) return missing(first.kind === 'forgotten' ? 'forgotten' : 'unreachable');
  const second = await readChecked(deps.copy, copy.key, copy.sha256);
  if (second.kind === 'ok') {
    logger.warn({ invoiceId, first: first.kind }, 'invoice PDF: served from the copy');
    return second;
  }
  if (second.kind === 'wrong') await wrong(COPY_PROVIDER);
  return missing(second.kind);
}

/**
 * `GET /v1/payroll/invoices/:id/pdf` (ADR 0037 § 7): the PDF read under the invoice's policy (`checkedInvoicePdf`),
 * `invoice_pdf_gone` when development's stores in memory lost it, `invoice_pdf_unavailable` when neither bucket gives
 * it back for any other reason.
 */
export async function downloadInvoicePdf(
  deps: Pick<InvoicePdfDeps, 'store' | 'primary' | 'copy'>,
  userId: UserId,
  invoiceId: InvoiceId,
  logger: JobLogger,
): Promise<DownloadedPdf> {
  const found = await deps.store.pdfFor(userId, invoiceId);
  if (found === null) throw new InvoiceNotFound();
  if (found.pdf === null) throw new InvoicePdfNotFound();
  const checked = await checkedInvoicePdf(
    deps,
    { invoiceId, memberId: found.memberId, number: found.number, pdf: found.pdf },
    logger,
  );
  // Lost with development's memory, it never comes back: said so, never « réessaie » (recette EQP-09).
  if (checked.kind === 'forgotten') throw new InvoicePdfGone();
  // A wrong file and buckets out of reach give the same answer: the PDF cannot be served now.
  if (checked.kind !== 'ok') throw new InvoicePdfUnavailable();
  return { fileName: `${found.number}.pdf`, bytes: checked.bytes };
}
