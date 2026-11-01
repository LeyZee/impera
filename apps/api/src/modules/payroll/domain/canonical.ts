import { createHash } from 'node:crypto';

/**
 * One text for one value, whatever the order its keys were written in: object keys sorted at every depth, arrays kept
 * in their order (the caller sorts what has no order of its own). What `inputs_hash` is the SHA-256 of.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sorted(value));
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, one]) => one !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([key, one]) => [key, sorted(one)]));
  }
  return value;
}

/** The SHA-256 of `value`'s canonical text, in lower-case hexadecimal. */
export function sha256Of(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
