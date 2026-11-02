import type { JournalEntry, LedgerAccounts } from './journal';

/**
 * The journal as a file the accountant imports (EQ-06 lot 7b): the 18 columns of the FEC (art. A47 A-1 du LPF), one
 * line per line of an entry, separated by tabs, dates as AAAAMMJJ, amounts with a decimal comma, in ISO 8859-15. It is
 * an import file of the contractors' journals, never the agency's legal FEC: its name says so (`journalFileName`).
 */

const COLUMNS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;

const JOURNAL_NAMES = { purchases: 'Achats prestataires', bank: 'Banque' } as const;

/** A day as the FEC writes it: AAAAMMJJ. */
const fecDay = (day: string): string => day.replaceAll('-', '');

/** An amount as the FEC writes it: euros with a decimal comma, never negative, never a thousands separator. */
function fecAmount(minor: number): string {
  const whole = Math.abs(minor);
  return `${String(Math.trunc(whole / 100))},${String(whole % 100).padStart(2, '0')}`;
}

/** A text field: no tab nor line break, which would break the columns. */
const field = (text: string): string => text.replace(/[\t\r\n]+/gu, ' ').trim();

/**
 * The file's text: the columns' names, then each line of each entry in order. Each journal numbers its entries from
 * 1, in the order given (by day); an entry's lines share its number, day and piece. A line takes its amount in the
 * debit column above zero, in the credit column below.
 */
export function fecText(entries: readonly JournalEntry[], accounts: LedgerAccounts): string {
  const numbers = { purchases: 0, bank: 0 };
  const rows: string[] = [COLUMNS.join('\t')];
  for (const entry of entries) {
    numbers[entry.journal] += 1;
    const code = entry.journal === 'purchases' ? accounts.purchaseJournal : accounts.bankJournal;
    for (const line of entry.lines) {
      rows.push(
        [
          code,
          JOURNAL_NAMES[entry.journal],
          String(numbers[entry.journal]),
          fecDay(entry.date),
          line.account,
          field(line.accountLabel),
          line.auxiliary?.account ?? '',
          field(line.auxiliary?.label ?? ''),
          field(entry.pieceRef),
          fecDay(entry.date),
          field(entry.label),
          fecAmount(line.amountMinor > 0 ? line.amountMinor : 0),
          fecAmount(line.amountMinor < 0 ? line.amountMinor : 0),
          line.lettering?.code ?? '',
          line.lettering === null ? '' : fecDay(line.lettering.on),
          fecDay(entry.date),
          '',
          '',
        ].join('\t'),
      );
    }
  }
  return `${rows.join('\r\n')}\r\n`;
}

/** The file's name, distinct from the legal FEC's (`<SIREN>FEC<AAAAMMJJ>.txt`). */
export function journalFileName(from: string, to: string): string {
  return `journal-prestataires_${fecDay(from)}_${fecDay(to)}.txt`;
}

/** The characters ISO 8859-15 puts where ISO 8859-1 has others. */
const LATIN9: ReadonlyMap<string, number> = new Map([
  ['€', 0xa4],
  ['Š', 0xa6],
  ['š', 0xa8],
  ['Ž', 0xb4],
  ['ž', 0xb8],
  ['Œ', 0xbc],
  ['œ', 0xbd],
  ['Ÿ', 0xbe],
]);
/** The ISO 8859-1 characters ISO 8859-15 replaced. */
const REPLACED = new Set([0xa4, 0xa6, 0xa8, 0xb4, 0xb8, 0xbc, 0xbd, 0xbe]);
/** What a character ISO 8859-15 lacks becomes. */
const NEAREST: ReadonlyMap<string, string> = new Map([
  ['‘', "'"],
  ['’', "'"],
  ['‚', "'"],
  ['′', "'"],
  ['´', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  ['¨', '"'],
  ['–', '-'],
  ['—', '-'],
  ['−', '-'],
  ['…', '...'],
  ['¼', '1/4'],
  ['½', '1/2'],
  ['¾', '3/4'],
  ['¸', ','],
  ['¦', '|'],
  ['¤', '?'],
]);

/** The byte of a character in ISO 8859-15, or `null` when it has none. */
function latin9Byte(character: string): number | null {
  const special = LATIN9.get(character);
  if (special !== undefined) return special;
  const code = character.codePointAt(0) ?? 0;
  if (code >= 0x20 && code < 0x7f) return code;
  if (code === 0x09 || code === 0x0a || code === 0x0d) return code;
  if (code >= 0xa0 && code <= 0xff && !REPLACED.has(code)) return code === 0xa0 ? 0x20 : code;
  return null;
}

/**
 * The text in ISO 8859-15, the FEC's encoding. A character it lacks takes its nearest (typographic quotes and
 * dashes, fractions), else its letter without its accent, else « ? »; every space is a plain space.
 */
export function latin9(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of text.replace(/[\u2000-\u200a\u202f\u205f\u3000]/gu, ' ')) {
    const byte = latin9Byte(character);
    if (byte !== null) {
      bytes.push(byte);
      continue;
    }
    const nearest = NEAREST.get(character) ?? character.normalize('NFD').replace(/\p{M}/gu, '');
    for (const one of nearest === character ? '?' : nearest) bytes.push(latin9Byte(one) ?? 0x3f);
  }
  return Uint8Array.from(bytes);
}
