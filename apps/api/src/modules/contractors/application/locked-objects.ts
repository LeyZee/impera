import { createHash } from 'node:crypto';

import type { InvoiceObjectStore, JobLogger } from '../domain/ports';

/**
 * What the PDFs of the invoices and the contractors' documents share in their buckets (ADR 0037 § 4 to § 7): an
 * object is named by its SHA-256, read back before it is trusted, and its compliance lock only ever lengthens.
 */
export const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * The lock of an object found under its key, made to hold at least until `due` (Bilan on #335): a shorter one, left
 * by a run under other settings or a bucket's default, is lengthened (a compliance lock lengthens, never shortens),
 * then read back. The lock the caller then keeps is the one the bucket names. A bucket that refuses throws; a shorter
 * lock is never taken for one that holds.
 */
export async function lockAtLeast(
  bucket: InvoiceObjectStore,
  key: string,
  found: Date,
  due: Date,
  logger: JobLogger,
): Promise<Date> {
  if (found.getTime() >= due.getTime()) return found;
  await bucket.lengthenLock(key, due);
  const after = (await bucket.read(key))?.retainUntil ?? null;
  if (after === null || after.getTime() < due.getTime()) {
    throw new Error(`locked object: the lock of ${key} still ends before ${due.toISOString()}`);
  }
  logger.warn(
    { key, found: found.toISOString(), lock: after.toISOString() },
    'locked object: a lock shorter than due, lengthened',
  );
  return after;
}

/** An object read back: its bytes when their SHA-256 is the expected one, `wrong` or `unreachable` otherwise. */
export type Checked =
  { readonly kind: 'ok'; readonly bytes: Uint8Array } | { readonly kind: 'wrong' | 'unreachable' };

export async function readChecked(store: InvoiceObjectStore, key: string, sha256: string): Promise<Checked> {
  let found: Awaited<ReturnType<InvoiceObjectStore['read']>>;
  try {
    found = await store.read(key);
  } catch {
    return { kind: 'unreachable' };
  }
  // A row whose object is gone is a wrong file too: the bucket's lock should have kept it. A store in memory forgets
  // its objects with the process (development): one it no longer holds is out of reach, not damaged.
  if (found === null) return { kind: store.volatile ? 'unreachable' : 'wrong' };
  if (sha256Hex(found.bytes) !== sha256) return { kind: 'wrong' };
  return { kind: 'ok', bytes: found.bytes };
}
