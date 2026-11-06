import {
  scriptSegmentCodes,
  scriptSlots,
  type MediaSlotKind,
  type ScriptSegment,
  type ScriptSlotKey,
  type ScriptVariantLetter,
} from '@impera/contracts';

/**
 * The script's naming (ADR 0056 § 5, SC-03): the names the server gives a sent script's files so that the alphabetical
 * order is the script's order, everywhere (the storage, the ZIP export, Reveal's vault). Pure: the drop's files and
 * her script number come from the store.
 *
 * - folder `S<nnn>-<moment>-<theme>`: her script number on three digits, `jour` or `nuit`, the structure's name in
 *   lowercase ASCII and hyphens;
 * - file `<pp>-<code>-<ii>-<kind>.<ext>`: the segment's position on two digits, its code with the series (`E2A`,
 *   `P12`), the place in the series on two digits (`00` is the card's, never a medium's), `carton`, `photo`, `video` or
 *   `vocal`.
 *
 * Two digits are enough: a structure has 24 segments and a segment 12 slots at most (`SCRIPT_SEGMENTS_MAX`,
 * `MEDIA_SLOTS_MAX`). The variants of a stage share its position and its number, their letter orders them.
 */

export type ScriptFileKind = 'carton' | 'photo' | 'video' | 'vocal';

/** The moment a script was shot as: a « both » structure is shot as the one its request says. */
export type ShotMoment = 'day' | 'night';

const KIND_OF_SLOT: Record<MediaSlotKind, ScriptFileKind> = {
  image: 'photo',
  video: 'video',
  audio: 'vocal',
};

const MOMENT_WORD: Record<ShotMoment, string> = { day: 'jour', night: 'nuit' };

/** The theme's length in a folder name: a structure's name is 60 characters at most, a folder stays readable. */
const THEME_MAX = 40;

/** Lowercase ASCII and hyphens: accents dropped (« Été » gives `ete`), emoji and punctuation gone, never empty. */
export function namingSlug(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, THEME_MAX)
    .replace(/-+$/u, '');
  return slug === '' ? 'script' : slug;
}

const twoDigits = (n: number): string => String(n).padStart(2, '0');

/** `S014-nuit-salon`. Her script number counts from 1, without a gap (the store gives it). */
export function scriptFolderName(number: number, moment: ShotMoment, theme: string): string {
  if (!Number.isInteger(number) || number < 1)
    throw new RangeError(`A script number counts from 1: ${String(number)}`);
  return `S${String(number).padStart(3, '0')}-${MOMENT_WORD[moment]}-${namingSlug(theme)}`;
}

/** A file's extension, lowercase letters and digits only (`JPG` gives `jpg`); `bin` when nothing is left. */
export function namingExtension(extension: string): string {
  const clean = extension.toLowerCase().replace(/[^a-z0-9]/gu, '');
  return clean === '' ? 'bin' : clean;
}

/** One entry of a script's folder, in its order: a card (`slotKey` null, place 0) or the medium of one slot. */
export interface ScriptFolderEntry {
  /** The segment's place in the script, from 1. */
  readonly position: number;
  /** The segment's code with the series: `E1`, `E2A`, `P12`. */
  readonly code: string;
  readonly variant: ScriptVariantLetter | null;
  readonly segmentKey: string;
  /** 0 for the card, then 1 for the series' first slot. */
  readonly place: number;
  readonly kind: ScriptFileKind;
  readonly slotKey: ScriptSlotKey | null;
  /** Without its extension: `03-E2A-01-photo`. */
  readonly stem: string;
}

/**
 * Every entry of a script's folder, in the script's order: for each segment, each series in turn, its card first when
 * the agency puts cards in the folder (a setting per creator, on by default, ADR 0056 § 3), then its slots. The order
 * of this list is the alphabetical order of its stems.
 */
export function scriptFolderEntries(
  segments: readonly ScriptSegment[],
  options: { readonly cards: boolean },
): ScriptFolderEntry[] {
  const codes = scriptSegmentCodes(segments);
  const slots = scriptSlots(segments);
  const entries: ScriptFolderEntry[] = [];
  segments.forEach((segment, index) => {
    const position = codes[index]?.position ?? index + 1;
    const series: readonly (ScriptVariantLetter | null)[] =
      segment.kind === 'stage' && segment.variants.length > 0
        ? segment.variants.map((variant) => variant.letter)
        : [null];
    for (const variant of series) {
      const code = `${codes[index]?.code ?? '?'}${variant ?? ''}`;
      const head = `${twoDigits(position)}-${code}`;
      const common = { position, code, variant, segmentKey: segment.key };
      // A bridge without a medium keeps its card: the chatters find their way by the cards.
      if (options.cards)
        entries.push({ ...common, place: 0, kind: 'carton', slotKey: null, stem: `${head}-00-carton` });
      for (const slot of slots)
        if (slot.segmentKey === segment.key && slot.variant === variant) {
          const place = slot.rank + 1;
          const kind = KIND_OF_SLOT[slot.slot.kind];
          entries.push({
            ...common,
            place,
            kind,
            slotKey: slot.key,
            stem: `${head}-${twoDigits(place)}-${kind}`,
          });
        }
    }
  });
  return entries;
}

/** A file's whole name: `03-E2A-01-photo.jpg`. */
export const scriptFileName = (entry: Pick<ScriptFolderEntry, 'stem'>, extension: string): string =>
  `${entry.stem}.${namingExtension(extension)}`;
