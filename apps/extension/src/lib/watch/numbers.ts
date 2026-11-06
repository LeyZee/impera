/**
 * A count as Instagram writes it on the page (VEI-02): « 1 234 », « 12,3 k », « 1,2 M », « 4.5K », « 2 Md », with a
 * plain, non-breaking or narrow non-breaking space anywhere. Read from the text alone; anything that is not plainly a
 * count is null, never 0 (a count the page does not show is unknown, not none).
 */

/** Any space, the non-breaking and narrow non-breaking ones included (`\s` holds them). */
const SPACES = /\s+/gu;

/** The suffixes a count may carry, French and English, with what they multiply by. */
const SCALES: readonly (readonly [RegExp, number])[] = [
  [/^(?:md|mrd|b|bn|milliards?|billions?)$/u, 1_000_000_000],
  [/^(?:m|mn|millions?)$/u, 1_000_000],
  [/^(?:k|k\.|mille)$/u, 1_000],
];

function scaleOf(suffix: string): number | null {
  if (suffix === '') return 1;
  for (const [pattern, scale] of SCALES) if (pattern.test(suffix)) return scale;
  return null;
}

/**
 * The digits of a count without a suffix: separators between groups of three are thousands (« 1 234 », « 1,234 »,
 * « 1.234 »); any other separator makes it unreadable.
 */
function wholeOf(digits: string): number | null {
  if (/^\d+$/u.test(digits)) return Number(digits);
  if (/^\d{1,3}(?:[ ,.]\d{3})+$/u.test(digits)) return Number(digits.replace(/[ ,.]/gu, ''));
  return null;
}

export function parseCount(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const compact = text.replace(SPACES, ' ').trim().toLowerCase();
  const match = /^(\d[\d ,.]*?)\s?([a-z.]*)$/u.exec(compact);
  if (match === null) return null;
  const [, number = '', suffix = ''] = match;
  const scale = scaleOf(suffix);
  if (scale === null) return null;
  if (scale === 1) {
    const whole = wholeOf(number.trim());
    return whole !== null && Number.isSafeInteger(whole) ? whole : null;
  }
  // With a suffix, a comma or a dot is the decimal mark (« 12,3 k », « 4.5K »), and one only.
  const decimal = /^(\d+)(?:[,.](\d+))?$/u.exec(number.replace(/ /gu, ''));
  if (decimal === null) return null;
  const [, units = '', tenths = ''] = decimal;
  const value = Math.round(Number(`${units}.${tenths === '' ? '0' : tenths}`) * scale);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * The first count in a longer text (« 1 234 mentions J’aime », « 12,3 k vues »): the count is the first run of digits
 * and separators, with the suffix right after it if there is one.
 */
export function firstCountIn(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const compact = text.replace(SPACES, ' ');
  const match = /\d[\d ,.]*(?:\s?(?:md|mrd|bn|b|mn|m|k)(?![a-zà-ÿ]))?/iu.exec(compact);
  return match === null ? null : parseCount(match[0].replace(/[ ,.]+$/u, ''));
}
