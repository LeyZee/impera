import {
  scriptSegmentCodes,
  scriptSlots,
  type ContentDropFile,
  type MediaSlot,
  type ScriptSegment,
  type ScriptSlot,
  type ScriptVariantLetter,
} from '@impera/contracts';

/*
 * Her script, card by card (SC-02 lot b2, ADR 0056 § 4): one screen per card, a stage with variants giving one card
 * per series (each series is shot whole), then the final preview. Everything here is read from the frozen version
 * and from the files the server holds: nothing of her script lives on this phone but the sends it runs.
 */

/** One screen of her script: a card and the slots she fills under it. */
export interface ScriptCard {
  readonly segmentKey: string;
  readonly variant: ScriptVariantLetter | null;
  /** « E1 », « E2A », « P12 ». */
  readonly code: string;
  /** The stage's name (« Chambre »), or « Pont vers Chambre ». */
  readonly title: string;
  /** « Série A · Lumière tamisée », the bridge's teaser, or nothing. */
  readonly detail: string | null;
  readonly slots: readonly ScriptSlot[];
}

/** The screens of her script, in its order; a segment without a slot gives none (a card with nothing to shoot). */
export function scriptCards(segments: readonly ScriptSegment[]): ScriptCard[] {
  const slots = scriptSlots(segments);
  const codes = new Map(scriptSegmentCodes(segments).map((entry) => [entry.key, entry.code]));
  const names = new Map<string, string>();
  for (const segment of segments) if (segment.kind === 'stage') names.set(segment.key, segment.name);
  const cards: ScriptCard[] = [];
  for (const segment of segments) {
    const series: readonly (ScriptVariantLetter | null)[] =
      segment.kind === 'stage' && segment.variants.length > 0
        ? segment.variants.map((variant) => variant.letter)
        : [null];
    const code = codes.get(segment.key) ?? '?';
    for (const variant of series) {
      const own = slots.filter((slot) => slot.segmentKey === segment.key && slot.variant === variant);
      if (own.length === 0) continue;
      const hint =
        segment.kind === 'stage' && variant !== null
          ? (segment.variants.find((one) => one.letter === variant)?.hint ?? null)
          : null;
      cards.push({
        segmentKey: segment.key,
        variant,
        code: `${code}${variant ?? ''}`,
        title:
          segment.kind === 'stage'
            ? segment.name
            : `Pont vers ${names.get(segment.to) ?? 'l’étape suivante'}`,
        detail:
          segment.kind === 'bridge'
            ? segment.teaser
            : variant === null
              ? segment.intention
              : `Série ${variant}${hint === null ? '' : ` · ${hint}`}`,
        slots: own,
      });
    }
  }
  return cards;
}

/** A slot's live file: the one the server holds for it, `undefined` while it is empty. */
export function fileOfSlot(files: readonly ContentDropFile[], key: string): ContentDropFile | undefined {
  return files.find((file) => file.slotKey === key);
}

/** Whether a slot counts for « Envoyer le script »: a file in it, not refused (one still going up counts). */
export const isFilled = (file: ContentDropFile | undefined): boolean =>
  file !== undefined && file.state !== 'refused';

/** Her progress: the slots she may not leave out, how many are filled. */
export function progressOf(
  cards: readonly ScriptCard[],
  files: readonly ContentDropFile[],
): { readonly filled: number; readonly required: number } {
  const required = cards.flatMap((card) => card.slots).filter((slot) => !slot.slot.optional);
  return {
    required: required.length,
    filled: required.filter((slot) => isFilled(fileOfSlot(files, slot.key))).length,
  };
}

/** Whether a card is done: each slot she may not leave out filled. */
export const cardDone = (card: ScriptCard, files: readonly ContentDropFile[]): boolean =>
  card.slots.every((slot) => slot.slot.optional || isFilled(fileOfSlot(files, slot.key)));

/** « 1 / 2 médias », then « · 1 facultatif » when the card has slots she may leave out. */
export function cardMeta(card: ScriptCard, files: readonly ContentDropFile[]): string {
  const required = card.slots.filter((slot) => !slot.slot.optional);
  const optional = card.slots.length - required.length;
  const filled = required.filter((slot) => isFilled(fileOfSlot(files, slot.key))).length;
  const count = `${String(filled)} / ${String(required.length)} média${required.length > 1 ? 's' : ''}`;
  return optional === 0 ? count : `${count} · ${String(optional)} facultatif${optional > 1 ? 's' : ''}`;
}

const KIND_WORDS: Readonly<Record<MediaSlot['kind'], string>> = {
  image: 'Photo',
  video: 'Vidéo',
  audio: 'Vocal',
};

/** « Vidéo · 5 à 20 s », « Vocal · 30 s au plus », « Photo »; « facultatif » when she may leave it out. */
export function slotLine(slot: MediaSlot): string {
  const kind = KIND_WORDS[slot.kind];
  const length =
    slot.kind === 'video'
      ? ` · ${String(slot.minSeconds)} à ${String(slot.maxSeconds)} s`
      : slot.kind === 'audio'
        ? ` · ${String(slot.maxSeconds)} s au plus`
        : '';
  return `${kind}${length}${slot.optional ? ' · facultatif' : ''}`;
}

/** What her picker opens on, for a slot: its kind's files only. */
export function acceptOfSlot(slot: MediaSlot): string {
  if (slot.kind === 'image') return 'image/*,.heic,.heif';
  if (slot.kind === 'video') return 'video/*,.mov,.m4v,.3gp,.mkv,.webm,.avi';
  return 'audio/*,.m4a,.mp3,.aac';
}

/** « Choisir une photo », « Choisir une vidéo », « Choisir un vocal ». */
export const chooseWord = (slot: MediaSlot): string =>
  slot.kind === 'image'
    ? 'Choisir une photo'
    : slot.kind === 'video'
      ? 'Choisir une vidéo'
      : 'Choisir un vocal';
