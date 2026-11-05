import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class names, letting the last Tailwind utility win (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

/**
 * The letter of an avatar: the first letter or digit of the name (« < », « « » or an emoji before it are skipped,
 * recette 05/11, PRO-17), an accented letter whole. A name without any keeps its first character as the eye sees it,
 * an emoji whole, never half of one (`slice(0, 1)` cuts « 💋 » in two). « ? » for a name with nothing in it.
 */
export function initialOf(name: string): string {
  const all = [...graphemes.segment(name.trim())];
  const letter = all.find(({ segment }) => /^[\p{L}\p{N}]/u.test(segment)) ?? all[0];
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
