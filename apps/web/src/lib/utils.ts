import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class names, letting the last Tailwind utility win (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

/**
 * The letter of an avatar: the first letter, digit or emoji of the name, past the punctuation and the signs before it
 * (« < », « « », recette 05/11, PRO-17), an accented letter whole. An emoji stays whole, never half of one
 * (`slice(0, 1)` cuts « 💋 » in two): a pseudo that starts with one shows it, as Suivi does. A name of signs alone
 * keeps its first one; « ? » for a name with nothing in it.
 */
export function initialOf(name: string): string {
  const all = [...graphemes.segment(name.trim())];
  const letter = all.find(({ segment }) => /^[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(segment)) ?? all[0];
  return letter === undefined ? '?' : letter.segment.toUpperCase();
}

/**
 * « de Léa », « d’Anastasia » : « de » before a name, elided before a vowel (« Yvonne » too, not « Yasmine »). The
 * name is given as written; an h is left alone, since French cannot tell a mute one from the spelling.
 */
export function deOf(name: string): string {
  const bare = name.trim().normalize('NFD');
  return /^(?:[aeiou]|y[^aeiouy])/iu.test(bare) ? `d’${name.trim()}` : `de ${name.trim()}`;
}

/** `?membre=<id>` of an address when it holds a member's id, nothing otherwise: a broken link opens the page as is. */
export function memberOf(search: Record<string, unknown>): { membre?: string } {
  const { membre } = search;
  return typeof membre === 'string' && /^[0-9a-f-]{36}$/iu.test(membre) ? { membre } : {};
}

/**
 * A sentence written elsewhere (the server's words) set as French is: a no-break space before « : ; ? ! » and inside
 * « », so that a line never starts with a lone « : » on a phone (recette AGT-05, capture #627).
 */
export function frenchSpaces(text: string): string {
  return text.replace(/ ([:;?!»])/gu, ' $1').replace(/« /gu, '« ');
}
