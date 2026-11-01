/** A country's French name and flag from its ISO 3166 code: the browser knows every name, there is no list to keep. */

const NAMES = new Intl.DisplayNames(['fr'], { type: 'region' });

export function countryName(code: string): string {
  return NAMES.of(code) ?? code;
}

/** The flag emoji: each letter becomes its regional indicator (`BJ` → 🇧🇯). */
export function countryFlag(code: string): string {
  return code
    .toUpperCase()
    .replace(/[A-Z]/gu, (letter) => String.fromCodePoint(0x1f1a5 + letter.charCodeAt(0)));
}
