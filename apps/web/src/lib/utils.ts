import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merges class names, letting the last Tailwind utility win (shadcn/ui convention). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const graphemes = new Intl.Segmenter('fr', { granularity: 'grapheme' });

/**
 * The letter of an avatar: the first character as the eye sees it, an emoji or an accented letter whole, never half
 * of one (`slice(0, 1)` cuts « 💋 » in two). « ? » for a name with nothing in it.
 */
export function initialOf(name: string): string {
  const [first] = graphemes.segment(name.trim());
  return first === undefined ? '?' : first.segment.toUpperCase();
}

/** `?membre=<id>` of an address when it holds a member's id, nothing otherwise: a broken link opens the page as is. */
export function memberOf(search: Record<string, unknown>): { membre?: string } {
  const { membre } = search;
  return typeof membre === 'string' && /^[0-9a-f-]{36}$/iu.test(membre) ? { membre } : {};
}
