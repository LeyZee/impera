import {
  ACCOUNTING_ARCHIVE_MEDIA_TYPE,
  AccountingJournalSchema,
  ApiErrorSchema,
  Das2ExportSchema,
  JournalAccountNameSchema,
  type AccountingJournal,
  type AccountingPeriodQuery,
  type Das2Export,
  type JournalAccountName,
} from '@impera/contracts';
import { z } from 'zod';

import { archiveName } from './model';

/**
 * `/v1/payroll/accounting/*` as Paie › Exports reads it (EQ-06 lot 8c), the owner's alone: the journal and the DAS2
 * recap in JSON, their file in base64; the archive as its ZIP, streamed. A file is kept as the bytes the server sent,
 * never read again as text: the journal's are ISO 8859-15, which a string would turn into UTF-8.
 */

const BASE = '/v1/payroll/accounting';

/** Why an export did not come: accounts the accountant has not given yet, a period or a year refused, a role. */
export type ExportRefusal =
  | { readonly kind: 'accounts_missing'; readonly missing: readonly JournalAccountName[] }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'failed' };

export type ExportOutcome<T> = { readonly kind: 'ok'; readonly value: T } | ExportRefusal;

const MissingSchema = z.object({ missing: z.array(JournalAccountNameSchema).min(1) });

async function refusalOf(response: Response): Promise<ExportRefusal> {
  const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) return { kind: 'failed' };
  const { code, details } = parsed.data.error;
  if (code === 'journal_accounts_missing_unprocessable') {
    const missing = MissingSchema.safeParse(details);
    return missing.success ? { kind: 'accounts_missing', missing: missing.data.missing } : { kind: 'failed' };
  }
  if (code === 'request_invalid') return { kind: 'invalid' };
  if (code === 'role_forbidden' || code === 'payroll_forbidden') return { kind: 'forbidden' };
  return { kind: 'failed' };
}

async function readJson<T>(url: string, schema: z.ZodType<T>): Promise<ExportOutcome<T>> {
  try {
    const response = await fetch(url, { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return await refusalOf(response);
    return { kind: 'ok', value: schema.parse(await response.json()) };
  } catch {
    return { kind: 'failed' };
  }
}

const periodSearch = (range: AccountingPeriodQuery): string =>
  new URLSearchParams({ from: range.from, to: range.to }).toString();

/** The contractors' journal of the period: its file, its count of entries, what it left unlettered or out. */
export const readJournal = (range: AccountingPeriodQuery): Promise<ExportOutcome<AccountingJournal>> =>
  readJson(`${BASE}/journal?${periodSearch(range)}`, AccountingJournalSchema);

/** The DAS2 recap of a calendar year: its CSV, and its beneficiaries in clear. */
export const readDas2 = (year: number): Promise<ExportOutcome<Das2Export>> =>
  readJson(`${BASE}/das2?year=${String(year)}`, Das2ExportSchema);

/** An archive as it came: its name and its bytes, which the screen never opens. */
export interface ArchiveFile {
  readonly fileName: string;
  readonly bytes: Blob;
}

/** The PDFs of the period's documents and their manifest, the stream read whole into one file. */
export async function readArchive(range: AccountingPeriodQuery): Promise<ExportOutcome<ArchiveFile>> {
  try {
    const response = await fetch(`${BASE}/archive?${periodSearch(range)}`, {
      credentials: 'include',
      cache: 'no-store',
    });
    if (!response.ok) return await refusalOf(response);
    // Its bytes, read whole and kept as they came: the ZIP is never opened here.
    const body = new Uint8Array(await response.arrayBuffer());
    return {
      kind: 'ok',
      value: {
        fileName: archiveName(response.headers.get('content-disposition'), range),
        bytes: new Blob([body], { type: ACCOUNTING_ARCHIVE_MEDIA_TYPE }),
      },
    };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * A file the API gave in base64, as its bytes: `atob` gives one character per byte, each taken back by its code, so
 * that no byte is ever decoded as text.
 */
export function bytesOf(content: string, mediaType: string): Blob {
  const binary = atob(content);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mediaType });
}

/** How long a saved file stays readable after its download starts. */
const KEPT_MS = 60_000;

/** Saves the bytes under their name, as they are. */
export function saveFile(bytes: Blob, fileName: string): void {
  const url = URL.createObjectURL(bytes);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Freed once the browser has read it: revoked at once, Safari and Firefox may save nothing.
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, KEPT_MS);
}
