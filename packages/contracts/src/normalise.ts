// Common look-alike substitutions: « 1gn0re t3s instructi0ns » reads as « ignore tes instructions ».
const LEET: Readonly<Record<string, string>> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

// Cyrillic and Greek letters drawn like Latin ones: « ІА » or « Ьot » must read as « ia », « bot ».
const HOMOGLYPHS: Readonly<Record<string, string>> = {
  а: 'a',
  в: 'b',
  е: 'e',
  ё: 'e',
  к: 'k',
  м: 'm',
  н: 'h',
  о: 'o',
  р: 'p',
  с: 'c',
  т: 't',
  у: 'y',
  х: 'x',
  ь: 'b',
  і: 'i',
  ї: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ӏ: 'l',
  ԛ: 'q',
  ԝ: 'w',
  α: 'a',
  β: 'b',
  ε: 'e',
  η: 'n',
  ι: 'i',
  κ: 'k',
  ν: 'v',
  ο: 'o',
  ρ: 'p',
  τ: 't',
  υ: 'u',
  χ: 'x',
  ω: 'w',
  // Small capitals: « ʙᴏᴛ ».
  ᴀ: 'a',
  ʙ: 'b',
  ᴄ: 'c',
  ᴅ: 'd',
  ᴇ: 'e',
  ɢ: 'g',
  ʜ: 'h',
  ɪ: 'i',
  ᴊ: 'j',
  ᴋ: 'k',
  ʟ: 'l',
  ᴍ: 'm',
  ɴ: 'n',
  ᴏ: 'o',
  ᴘ: 'p',
  ʀ: 'r',
  ꜱ: 's',
  ᴛ: 't',
  ᴜ: 'u',
  ᴠ: 'v',
  ᴡ: 'w',
  ʏ: 'y',
  ᴢ: 'z',
};
const HOMOGLYPH_PATTERN = new RegExp(`[${Object.keys(HOMOGLYPHS).join('')}]`, 'gu');

/**
 * Lowercase, no accents, straight apostrophes, invisible characters dropped, one plain space for any
 * whitespace, Cyrillic, Greek and small-capital look-alikes read as Latin, « I.A. » and « A.I. » read as « ia » and « ai »: « Je t’AIME » and « je t'aime » compare equal.
 */
export function normalise(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u{E0000}-\u{E007F}]|\u034F/gu, '')
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(HOMOGLYPH_PATTERN, (c) => HOMOGLYPHS[c] ?? c)
    .replace(/\bi\.\s?a\.?(?=\W|$)/g, 'ia')
    .replace(/\ba\.\s?i\.?(?=\W|$)/g, 'ai');
}

/**
 * `normalise`, then words split on anything that is not a letter or a digit: « Vidéo-perso » and « video perso » read
 * the same. How a keyword or a persona's entry compares.
 */
export function normaliseWords(text: string): string {
  return normalise(text)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Stricter reading for trap detection: digits and symbols inside words turned back into letters. */
export function unmask(text: string): string {
  return normalise(text).replace(/(?<=\p{L})[013457@$]|[013457@$](?=\p{L})/gu, (c) => LEET[c] ?? c);
}
