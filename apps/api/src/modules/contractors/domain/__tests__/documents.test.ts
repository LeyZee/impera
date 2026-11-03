import {
  CONTRACTOR_DOCUMENT_MAX_BYTES,
  ContractorDocumentIdSchema,
  TeamMemberIdSchema,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  documentMediaTypeOf,
  documentMediaTypeOfKey,
  documentRetainUntil,
  documentStorageKey,
  documentUploadLockUntil,
} from '../documents';

const PDF = new TextEncoder().encode('%PDF-1.7\n%invented for the test\n');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46]);

describe('Équipe › Pièces du prestataire : le fichier, sa clé, son verrou (EQ-06 lot 5c)', () => {
  it('reads what a file is from its first bytes, never from what the client says', () => {
    expect(documentMediaTypeOf(PDF)).toBe('application/pdf');
    expect(documentMediaTypeOf(PNG)).toBe('image/png');
    expect(documentMediaTypeOf(JPEG)).toBe('image/jpeg');
    for (const other of [
      new TextEncoder().encode('<html><script>alert(1)</script></html>'),
      new TextEncoder().encode('%PDF'),
      PNG.slice(0, 7),
      new Uint8Array(),
    ]) {
      expect(() => documentMediaTypeOf(other)).toThrow(
        expect.objectContaining({
          code: 'contractor_document_invalid',
          details: { reason: 'not_supported' },
        }),
      );
    }
  });

  it('refuses a file over 10 MB, and keeps one of 10 MB exactly', () => {
    const exactly = new Uint8Array(CONTRACTOR_DOCUMENT_MAX_BYTES);
    exactly.set(PDF);
    expect(documentMediaTypeOf(exactly)).toBe('application/pdf');
    const over = new Uint8Array(CONTRACTOR_DOCUMENT_MAX_BYTES + 1);
    over.set(PDF);
    expect(() => documentMediaTypeOf(over)).toThrow(
      expect.objectContaining({ code: 'contractor_document_invalid', details: { reason: 'too_heavy' } }),
    );
  });

  it('keeps each document under its own key, whose extension says what it is', () => {
    const member = TeamMemberIdSchema.parse('0195f4a0-0000-7000-8000-00000000000a');
    const document = ContractorDocumentIdSchema.parse('0195f4a0-0000-7000-8000-00000000000b');
    const key = documentStorageKey(member, document, 'image/jpeg');
    expect(key).toBe(`contractor-documents/${member}/${document}.jpg`);
    expect(documentMediaTypeOfKey(key)).toBe('image/jpeg');
    expect(documentMediaTypeOfKey(documentStorageKey(member, document, 'application/pdf'))).toBe(
      'application/pdf',
    );
    expect(documentMediaTypeOfKey(documentStorageKey(member, document, 'image/png'))).toBe('image/png');
    expect(documentMediaTypeOfKey(`invoices/2026/${document}.gif`)).toBeNull();
  });

  it('locks a file thirty days at its upload, until the owner’s check', () => {
    expect(documentUploadLockUntil(new Date('2026-11-01T21:00:00Z')).toISOString()).toBe(
      '2026-12-01T21:00:00.000Z',
    );
  });

  it('keeps an accepted document as long as the invoices it may cover, issued up to a year after its last day', () => {
    // A 2026 certificate, accepted in 2026: its invoices go out until 2027, kept ten years after the close of 2027.
    expect(documentRetainUntil('2026-12-31', '2026-11-02', 12).toISOString()).toBe(
      '2038-01-01T00:00:00.000Z',
    );
    // Accepted late, after its last day: counted from the acceptance.
    expect(documentRetainUntil('2026-12-31', '2027-03-10', 12).toISOString()).toBe(
      '2039-01-01T00:00:00.000Z',
    );
    // A fiscal year closing in June.
    expect(documentRetainUntil('2026-12-31', '2026-11-02', 6).toISOString()).toBe('2038-07-01T00:00:00.000Z');
  });
});
