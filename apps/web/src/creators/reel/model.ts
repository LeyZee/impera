import {
  REEL_HOOK_WORDS_MAX,
  REEL_LINE_MAX,
  REEL_ON_SCREEN_WORDS_MAX,
  REEL_SECONDS_MAX,
  REEL_SECONDS_MIN,
  REEL_SHOTS_MAX,
  REEL_SHOTS_MIN,
  ReelBriefSchema,
  countWords,
  keepWords,
  type ReelBrief,
} from '@impera/contracts';

/*
 * « Fiche reel », the agency's form (VEI-08, ADR 0082 § 3), pure: what the fields hold, what is sent, what the preview
 * shows at each keystroke. The bounds and the count of words are the contract's, so that the counters and the server
 * never disagree.
 */

/** A shot as the form holds it: its key stays with it when it moves up or down. */
export interface ShotLine {
  readonly key: number;
  readonly text: string;
}

export interface ReelDraft {
  readonly hook: string;
  readonly onScreen: string;
  readonly shots: readonly ShotLine[];
  readonly ending: string;
  readonly seconds: number;
}

/** The step of the duration's slider, in seconds. */
export const REEL_SECONDS_STEP = 5;
const DEFAULT_SECONDS = 20;

let nextKey = 0;
const line = (text: string): ShotLine => {
  nextKey += 1;
  return { key: nextKey, text };
};

export const emptyReelDraft = (): ReelDraft => ({
  hook: '',
  onScreen: '',
  shots: Array.from({ length: REEL_SHOTS_MIN }, () => line('')),
  ending: '',
  seconds: DEFAULT_SECONDS,
});

export const reelDraftOf = (brief: ReelBrief | null): ReelDraft =>
  brief === null
    ? emptyReelDraft()
    : {
        hook: brief.hook,
        onScreen: brief.onScreen ?? '',
        shots: brief.shots.map(line),
        ending: brief.ending ?? '',
        seconds: brief.seconds,
      };

/** What a field of words keeps of a keystroke or a paste: never a word more than its bound, never a long line. */
export const typedWords = (text: string, max: number): string => keepWords(text, max).slice(0, REEL_LINE_MAX);

/** « 5 / 8 mots », and whether the field is full (its counter turns amber). */
export function wordCounter(text: string, max: number): { readonly label: string; readonly full: boolean } {
  const count = countWords(text);
  return { label: `${String(count)} / ${String(max)} mot${max > 1 ? 's' : ''}`, full: count >= max };
}

export const HOOK_COUNTER = (text: string): ReturnType<typeof wordCounter> =>
  wordCounter(text, REEL_HOOK_WORDS_MAX);
export const ON_SCREEN_COUNTER = (text: string): ReturnType<typeof wordCounter> =>
  wordCounter(text, REEL_ON_SCREEN_WORDS_MAX);

export const mayAddShot = (draft: ReelDraft): boolean => draft.shots.length < REEL_SHOTS_MAX;
export const mayRemoveShot = (draft: ReelDraft): boolean => draft.shots.length > REEL_SHOTS_MIN;

export const addShot = (draft: ReelDraft): ReelDraft =>
  mayAddShot(draft) ? { ...draft, shots: [...draft.shots, line('')] } : draft;

export const removeShot = (draft: ReelDraft, key: number): ReelDraft =>
  mayRemoveShot(draft) ? { ...draft, shots: draft.shots.filter((shot) => shot.key !== key) } : draft;

export const setShot = (draft: ReelDraft, key: number, text: string): ReelDraft => ({
  ...draft,
  shots: draft.shots.map((shot) =>
    shot.key === key ? { ...shot, text: text.slice(0, REEL_LINE_MAX) } : shot,
  ),
});

/** A shot one place up (`-1`) or down (`1`); at an end, nothing moves. */
export function moveShot(draft: ReelDraft, key: number, by: -1 | 1): ReelDraft {
  const at = draft.shots.findIndex((shot) => shot.key === key);
  const to = at + by;
  if (at < 0 || to < 0 || to >= draft.shots.length) return draft;
  const shots = [...draft.shots];
  const [moved] = shots.splice(at, 1);
  if (moved === undefined) return draft;
  shots.splice(to, 0, moved);
  return { ...draft, shots };
}

/** The duration on its slider: a step of 5, within its bounds. */
export const clampSeconds = (seconds: number): number =>
  Math.min(
    REEL_SECONDS_MAX,
    Math.max(REEL_SECONDS_MIN, Math.round(seconds / REEL_SECONDS_STEP) * REEL_SECONDS_STEP),
  );

const filled = (draft: ReelDraft): string[] =>
  draft.shots.map((shot) => shot.text.trim()).filter((text) => text !== '');

/** Nothing written yet: no sheet is sent, the shoot leaves without one. */
export const isBlank = (draft: ReelDraft): boolean =>
  draft.hook.trim() === '' &&
  draft.onScreen.trim() === '' &&
  filled(draft).length === 0 &&
  draft.ending.trim() === '';

export type ReelProblem = 'hook' | 'shots';

/** What still needs a word before it can leave, in amber under its field; nothing for a blank sheet. */
export function reelProblems(draft: ReelDraft): readonly ReelProblem[] {
  if (isBlank(draft)) return [];
  const problems: ReelProblem[] = [];
  if (countWords(draft.hook) === 0) problems.push('hook');
  if (filled(draft).length < REEL_SHOTS_MIN) problems.push('shots');
  return problems;
}

export const REEL_PROBLEM_WORDS: Readonly<Record<ReelProblem, string>> = {
  hook: 'Écris sa première phrase, ou vide toute la fiche.',
  shots: 'Deux plans au moins.',
};

const orNull = (text: string): string | null => (text.trim() === '' ? null : text.trim());

/** What is sent: the sheet as the server takes it, `null` for a blank one or one still to complete. */
export function reelBriefOf(draft: ReelDraft): ReelBrief | null {
  if (isBlank(draft)) return null;
  const parsed = ReelBriefSchema.safeParse({
    hook: draft.hook.trim(),
    onScreen: orNull(draft.onScreen),
    shots: filled(draft),
    ending: orNull(draft.ending),
    seconds: draft.seconds,
  });
  return parsed.success ? parsed.data : null;
}

/**
 * What the preview shows at each keystroke: the sheet as she will see it, what is not written yet left out (a first
 * sentence still empty reads « … »).
 */
export function previewOf(draft: ReelDraft): ReelBrief {
  return {
    hook: draft.hook.trim() === '' ? '…' : draft.hook.trim(),
    onScreen: orNull(draft.onScreen),
    shots: filled(draft),
    ending: orNull(draft.ending),
    seconds: draft.seconds,
  };
}

/** The field a guard names (`details.field` of a 422), in the words of the form. */
const GUARDED_FIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'Titre',
  toShoot: 'À tourner',
  reason: 'Pourquoi',
  purpose: 'À quoi ça sert',
  hook: 'Première phrase',
  onScreen: 'Texte à l’écran',
  shots: 'Plans',
  ending: 'Pour finir',
};

/**
 * The server's sentence on a guard (her limit, « jamais de nu », Instagram), said as it is, with the field at fault
 * when it names one: « Ce tournage enfreint la garde Instagram : corrige-le (Pour finir). »
 */
export function guardedSentence(message: string, details: Readonly<Record<string, unknown>>): string {
  const field = typeof details['field'] === 'string' ? GUARDED_FIELD_LABELS[details['field']] : undefined;
  return field === undefined ? `${message}.` : `${message} (${field}).`;
}
