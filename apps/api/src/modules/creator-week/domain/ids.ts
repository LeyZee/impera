import { createHash } from 'node:crypto';

/**
 * An id drawn from what a thing of her week is (ADR 0140 § 19 and § 22): the same week validated again writes the
 * same ids, so a replay doubles nothing. A UUID of version 8 (RFC 9562, custom), from a SHA-256.
 */
export function weekId(...parts: readonly string[]): string {
  const hex = createHash('sha256').update(parts.join('\u001f')).digest('hex');
  const variant = ((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** A « Jour de tournage » or « Livrer ma semaine » of her week. */
export const frameId = (creatorId: string, week: string, role: string, day: string): string =>
  weekId('creator-week', creatorId, week, role, day);

/** The line at `position` of a shooting day. */
export const lineId = (frame: string, position: number): string =>
  weekId('creator-week-line', frame, String(position));
