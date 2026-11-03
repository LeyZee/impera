import { Readable } from 'node:stream';

import {
  ACCOUNTING_JOURNAL_MEDIA_TYPE,
  DAS2_MEDIA_TYPE,
  type AccountingJournal,
  type AccountingPeriodQuery,
  type Das2Export,
  type Das2Query,
} from '@impera/contracts';
import { Zip, ZipPassThrough } from 'fflate';

import type { Actor, JobLogger } from '../../contractors/pure';
import type { CheckedPdf, PdfToServe } from '../../invoicing';
import { das2Csv, das2Declaration, das2FileName } from '../domain/accounting';
import {
  ARCHIVE_MANIFEST_NAME,
  archiveEntryName,
  archiveFileName,
  archiveManifest,
  type ArchiveEntry,
  type ArchiveEntryState,
} from '../domain/archive';
import { JournalAccountsMissing } from '../domain/errors';
import { fecText, journalFileName, latin9 } from '../domain/fec';
import { journalEntries, ledgerAccountsOf, transfersLeftOutInOrder } from '../domain/journal';
import type { ArchiveDocument, PayrollAccountingStore } from '../domain/ports';

/**
 * The accountant's exports, the owner's alone (EQ-06 lot 7; ADR 0023 « export comptable par période »):
 *
 * - **the journal** (lot 7b): the contractors' journal from one day to another, in a file the accountant imports. It
 *   refuses while an account or a journal is missing (`journal_accounts_missing_unprocessable`, the names in
 *   `details.missing`): none is ever guessed.
 * - **the DAS2 recap** (lot 7c): who was paid more than 2 400 € in a calendar year, under the identity their invoice
 *   froze, with what the accountant checks before declaring (`domain/accounting.ts`). A recap, not the declaration:
 *   the accountant files it.
 * - **the archive** (lot 7d): the PDF of each document issued in a range, read back against its fingerprint
 *   (`checkedInvoicePdf`), in a ZIP streamed one document at a time, with its manifest (`domain/archive.ts`).
 */
export interface PayrollAccounting {
  journal(actor: Actor, query: AccountingPeriodQuery): Promise<AccountingJournal>;
  das2(actor: Actor, query: Das2Query): Promise<Das2Export>;
  archive(actor: Actor, query: AccountingPeriodQuery, logger: JobLogger): Promise<AccountingArchive>;
}

/** The archive as the route sends it: its name, and its bytes as they are zipped. */
interface AccountingArchive {
  readonly fileName: string;
  readonly stream: Readable;
}

/** A rendered PDF read back against its fingerprint, from either bucket: pay's `checkedInvoicePdf` (ADR 0037 § 7). */
export type ArchivePdfs = (pdf: PdfToServe, logger: JobLogger) => Promise<CheckedPdf>;

/**
 * The archive's bytes, pulled by the response: each PDF read back and stored as it is (`ZipPassThrough`, a PDF is
 * compressed already), the next one read only once the bytes before have left, so that the range is never held in
 * memory. The manifest comes last, since it says what became of each document: a PDF not rendered yet, wrong at
 * its reading (the owner alerted by `checkedInvoicePdf`) or out of reach (the export to run again) is listed without
 * a file, never left out.
 */
/** What became of a document: no PDF yet, its file, or why neither bucket gave it. */
function stateOf(checked: CheckedPdf | null): ArchiveEntryState {
  if (checked === null) return 'not_rendered';
  if (checked.kind === 'ok') return 'archived';
  return checked.kind === 'wrong' ? 'unreadable' : 'unreachable';
}

async function* archiveChunks(
  pdfs: ArchivePdfs,
  documents: readonly ArchiveDocument[],
  logger: JobLogger,
): AsyncGenerator<Uint8Array> {
  const ready: Uint8Array[] = [];
  const zipping: { failure: Error | null } = { failure: null };
  const zip = new Zip((error, chunk) => {
    if (error === null) ready.push(chunk);
    else zipping.failure = error;
  });
  const add = (name: string, bytes: Uint8Array, day: Date): void => {
    const entry = new ZipPassThrough(name);
    entry.mtime = day;
    zip.add(entry);
    entry.push(bytes, true);
  };
  const entries: ArchiveEntry[] = [];
  for (const document of documents) {
    const { pdf } = document;
    const checked = pdf === null ? null : await pdfs({ ...document, pdf }, logger);
    // Dated of its issue, at noon so that no time zone moves it to another day.
    if (checked?.kind === 'ok')
      add(archiveEntryName(document.number), checked.bytes, new Date(`${document.issuedOn}T12:00:00Z`));
    entries.push({
      number: document.number,
      kind: document.kind,
      corrective: document.corrective,
      issuedOn: document.issuedOn,
      sha256: pdf?.sha256 ?? null,
      state: stateOf(checked),
    });
    if (zipping.failure !== null) throw zipping.failure;
    yield* ready.splice(0);
  }
  add(ARCHIVE_MANIFEST_NAME, new TextEncoder().encode(archiveManifest(entries)), new Date());
  zip.end();
  if (zipping.failure !== null) throw zipping.failure;
  yield* ready.splice(0);
}

export function createPayrollAccounting(store: PayrollAccountingStore, pdfs: ArchivePdfs): PayrollAccounting {
  return {
    journal: (actor, { from, to }) =>
      store.exportJournal(actor, from, to, (facts) => {
        const ledger = ledgerAccountsOf(facts.accounts);
        if ('missing' in ledger) throw new JournalAccountsMissing(ledger.missing);
        const { entries, unbalanced } = journalEntries(facts.contractors, ledger.accounts, from, to);
        return {
          fileName: journalFileName(from, to),
          mediaType: ACCOUNTING_JOURNAL_MEDIA_TYPE,
          content: Buffer.from(latin9(fecText(entries, ledger.accounts))).toString('base64'),
          entryCount: entries.length,
          unbalanced,
          transfersLeftOut: transfersLeftOutInOrder(facts.transfersLeftOut),
        };
      }),

    das2: (actor, { year }) =>
      store.exportDas2(actor, year, (facts): Das2Export => {
        const beneficiaries = das2Declaration(year, facts.contractors);
        return {
          year,
          fileName: das2FileName(year),
          mediaType: DAS2_MEDIA_TYPE,
          content: Buffer.from(das2Csv(beneficiaries), 'utf8').toString('base64'),
          beneficiaries,
          // The sums are what left, never recomputed: a contractor charging VAT is paid excluding it (accountant's question).
          notes: ['amounts_as_sent'],
        };
      }),

    archive: async (actor, { from, to }, logger) => {
      const documents = await store.archiveDocuments(actor, from, to);
      return {
        fileName: archiveFileName(from, to),
        stream: Readable.from(archiveChunks(pdfs, documents, logger)),
      };
    },
  };
}
