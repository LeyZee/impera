import type { DayItem, DayLine, DayPlatform, DropCategory } from '@impera/contracts';

import type { ColorKind } from './week-colors';

/** The colour a line of her day takes: her Reveal story and her video share her week's; the networks their own. */
export function kindOf(line: DayLine): ColorKind {
  if (line.item === 'reveal_story') return 'reveal_story';
  if (line.item === 'reveal_video') return 'feed_video';
  return line.platform === 'instagram' ? 'instagram' : 'telegram';
}

/** Where the bonus lines go, in her words. */
export const PLATFORM_WORDS: Readonly<Record<DayPlatform, string>> = {
  reveal: 'Reveal',
  instagram: 'Instagram',
  telegram: 'Telegram',
};

/** The count after a tap on her `index`-th mark: up to it, or one less when it was the last one done. */
export const doneAfterTap = (done: number, index: number): number => (done === index + 1 ? index : index + 1);

/** « 2 / 3 » of a group of lines. */
export function tallyOf(lines: readonly DayLine[]): { readonly done: number; readonly total: number } {
  return lines.reduce(
    (sum, line) => ({ done: sum.done + Math.min(line.done, line.target), total: sum.total + line.target }),
    { done: 0, total: 0 },
  );
}

/** The first sentence of a sheet, shown before she opens it: it never stops in the middle of a thought. */
export function firstSentence(sheet: string): string {
  const end = sheet.search(/[.:!?](\s|$)/u);
  return end === -1 ? sheet : sheet.slice(0, end + (sheet[end] === ':' ? 0 : 1)).trimEnd();
}

/** What she drops for a line her coffre does (ADR 0140, avenant du 27/11): Contenu's tile it opens on. */
export const DROP_FOR: Partial<Readonly<Record<DayItem, DropCategory>>> = { reveal_video: 'feed_video' };
