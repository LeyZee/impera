/**
 * The bytes a `Range` header asks of a medium of `size` bytes (RFC 9110 § 14.1.2), for a video played from the screen
 * (SC-04 lot c4): one range only, the one a player asks; `whole` without a header or with one we do not serve (several
 * ranges, another unit), when the whole medium is sent; `unsatisfiable` past its end. Both ends included.
 */
export type ByteRange =
  | { readonly kind: 'whole' }
  | { readonly kind: 'part'; readonly start: number; readonly end: number }
  | { readonly kind: 'unsatisfiable' };

const SINGLE = /^bytes=(\d*)-(\d*)$/u;

export function byteRangeOf(header: string | undefined, size: number): ByteRange {
  if (header === undefined) return { kind: 'whole' };
  const match = SINGLE.exec(header.trim());
  if (match === null) return { kind: 'whole' };
  const [, from = '', to = ''] = match;
  if (from === '' && to === '') return { kind: 'whole' };
  if (size === 0) return { kind: 'unsatisfiable' };
  if (from === '') {
    // `bytes=-500`: its last 500 bytes.
    const last = Number(to);
    if (last === 0) return { kind: 'unsatisfiable' };
    return { kind: 'part', start: Math.max(0, size - last), end: size - 1 };
  }
  const start = Number(from);
  if (start >= size) return { kind: 'unsatisfiable' };
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  if (end < start) return { kind: 'whole' };
  return { kind: 'part', start, end };
}
