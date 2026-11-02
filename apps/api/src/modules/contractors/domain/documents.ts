import {
  CONTRACTOR_DOCUMENT_MAX_BYTES,
  CONTRACTOR_DOCUMENT_MEDIA_TYPES,
  type ContractorDocumentId,
  type ContractorDocumentMediaType,
  type TeamMemberId,
} from '@nirvana/contracts';

import { addMonths } from './billing';
import { ContractorDocumentInvalid } from './errors';
import { invoicePdfRetainUntil } from './retention';

/**
 * The files of a contractor's documents (EQ-06 lot 5c): what a file is, where it is kept, and how long it is locked.
 * Pure: the bucket and the base are the store's.
 */

const EXTENSIONS: Readonly<Record<ContractorDocumentMediaType, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/**
 * What a file is, read from its first bytes, never from a name or a header the client gives: `%PDF-`, the PNG
 * signature, a JPEG's start of image. Anything else, or a file over 10 MB, is refused (`contractor_document_invalid`).
 */
export function documentMediaTypeOf(bytes: Uint8Array): ContractorDocumentMediaType {
  if (bytes.length > CONTRACTOR_DOCUMENT_MAX_BYTES) throw new ContractorDocumentInvalid('too_heavy');
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  throw new ContractorDocumentInvalid('not_supported');
}

/** The extension of a document's file: its key's, and its name's when it is downloaded. */
export const documentExtension = (mediaType: ContractorDocumentMediaType): string => EXTENSIONS[mediaType];

/** Where a document's file is kept: one key per document, written once, its extension saying what it is. */
export function documentStorageKey(
  memberId: TeamMemberId,
  documentId: ContractorDocumentId,
  mediaType: ContractorDocumentMediaType,
): string {
  return `contractor-documents/${memberId}/${documentId}.${EXTENSIONS[mediaType]}`;
}

/** What the file under `key` is, from its extension; `null` for a key this module never wrote. */
export function documentMediaTypeOfKey(key: string): ContractorDocumentMediaType | null {
  const extension = /\.([a-z]+)$/u.exec(key)?.[1];
  return CONTRACTOR_DOCUMENT_MEDIA_TYPES.find((mediaType) => EXTENSIONS[mediaType] === extension) ?? null;
}

/**
 * The lock a file gets at its upload, before the owner's check: thirty days. A file refused, or sent by mistake (a
 * photo that is not the document), is then locked no longer than that, and can be deleted once it lapses; only an
 * accepted document is kept with the invoices (`documentRetainUntil`).
 */
const DOCUMENT_UPLOAD_LOCK_DAYS = 30;

export function documentUploadLockUntil(now: Date): Date {
  return new Date(now.getTime() + DOCUMENT_UPLOAD_LOCK_DAYS * 86_400_000);
}

/**
 * The lock of an accepted document: as long as the invoices it may cover. Those are issued, at the latest, in the
 * year after its last day (a statement of December is invoiced in January), or after its acceptance when that comes
 * later; an invoice is kept ten years after the close of the fiscal year of its issue (`invoicePdfRetainUntil`). So:
 * ten years after the close of the fiscal year that holds the day a year after the later of the two.
 */
export function documentRetainUntil(lastDay: string, acceptedOn: string, fiscalYearEndMonth: number): Date {
  const from = lastDay > acceptedOn ? lastDay : acceptedOn;
  return invoicePdfRetainUntil(addMonths(from, 12), fiscalYearEndMonth);
}
