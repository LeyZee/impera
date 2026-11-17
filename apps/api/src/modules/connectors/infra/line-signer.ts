import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import type { EncryptionKey } from '@impera/db';

import { markedText, type LineSigner } from '../domain/agency-note';

const MARK = /^([a-z0-9]{1,16}):([0-9a-f]{64})$/u;

/**
 * The keyed marks of an account's note lines (ADR 0117 § 3): HMAC-SHA-256 under a key derived (HKDF) from each
 * `SESSION_ENCRYPTION_KEYS` key and the account id, never kept in the database. The newest key signs, `<version>:<hex>`;
 * a mark of an older key still kept is read, one of a key dropped is not (the line then reads as a human's).
 */
export function createLineSigner(keys: readonly EncryptionKey[], platformAccountId: string): LineSigner {
  const derived = new Map(
    keys.map((one) => [
      one.version,
      Buffer.from(hkdfSync('sha256', one.key, Buffer.alloc(0), `impera:note-line:${platformAccountId}`, 32)),
    ]),
  );
  const mac = (key: Buffer, line: string) =>
    createHmac('sha256', key).update(markedText(line), 'utf8').digest('hex');
  const newest = keys[0];
  if (newest === undefined) throw new Error('note lines: no key to sign with');
  return {
    sign: (line) => `${newest.version}:${mac(derived.get(newest.version) ?? Buffer.alloc(0), line)}`,
    signs: (line, mark) => {
      const parsed = MARK.exec(mark);
      const key = parsed === null ? undefined : derived.get(parsed[1] ?? '');
      if (parsed === null || key === undefined) return false;
      return timingSafeEqual(Buffer.from(mac(key, line), 'hex'), Buffer.from(parsed[2] ?? '', 'hex'));
    },
  };
}
