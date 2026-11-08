import {
  CONTENT_IDEAS_PER_DAY_MAX,
  INSTAGRAM_DROP_CATEGORIES,
  instagramFaults,
  normaliseWords,
  nudityIn,
  PUBLIC_DROP_CATEGORIES,
  type ContentIdeaDraft,
  type IdeaDropCategory,
  type PersonaLimits,
  type ReelBrief,
  type TrendSignalId,
} from '@impera/contracts';

/**
 * The code's filters on the morning ideas (ADR 0060 § 4), after the generation and never left to the prompt. An idea is
 * dropped when it touches one of her limits, is too close to an idea of the last 30 days, is close to an idea she or
 * the agency refused (never again, whatever its date), says nudity for a public output or breaks the Instagram guard,
 * or cites no live signal. What is left, three at most, is the day's ideas; nothing left, no idea that day.
 */

/** Why an idea was dropped. */
type IdeaDrop =
  | GuardFault
  | { readonly reason: 'too_close' }
  | { readonly reason: 'refused_before' }
  | { readonly reason: 'no_live_signal' }
  | { readonly reason: 'over_daily_cap' };

/** An idea already known, as the filters compare it. */
export type KnownIdea = Pick<ContentIdeaDraft, 'title' | 'category' | 'toShoot' | 'signalId'>;

export interface IdeaFilterContext {
  /** Her persona's limits (the active version); null without one, and then nothing passes. */
  readonly limits: PersonaLimits | null;
  /**
   * The one reading of a persona's entry against a text (`touchesTerm` of the agent's index, ADR 0056 § 1): handed by
   * the application, never copied here.
   */
  readonly touches: (text: string, term: string) => boolean;
  /** Her ideas proposed in the last 30 days, whatever became of them. */
  readonly recent: readonly KnownIdea[];
  /** Every idea of hers ever refused by the agency (`refused`) or declined by her in her agenda (`declined`). */
  readonly refused: readonly KnownIdea[];
  /** The signals live now that she may read (hers and the agency's). */
  readonly liveSignals: ReadonlySet<TrendSignalId>;
}

/**
 * « Trop proche », fixed in code: the same drop category and the same origin signal, or the words of the title and of
 * « à tourner » shared at `CLOSE_WORDS_OVERLAP` or more (Jaccard index of the two sets of words of three letters or
 * more, small words left out).
 */
const CLOSE_WORDS_OVERLAP = 0.6;

const SMALL_WORDS = new Set([
  'avec',
  'dans',
  'des',
  'elle',
  'est',
  'les',
  'mais',
  'pour',
  'par',
  'que',
  'qui',
  'son',
  'ses',
  'sur',
  'ton',
  'tes',
  'une',
  'aux',
  'the',
  'and',
]);

/**
 * A word with its plural folded, by the rule of the agent's guards: a final « s » or « x » is dropped when four letters
 * at least remain (« pieds » reads « pied », « bras » stays « bras »). The guards turn it into a pattern; here it is a
 * stem, since « trop proche » compares sets of words and never searches a term.
 */
function stemOf(word: string): string {
  return /^(\p{L}{4,})[sx]$/u.exec(word)?.[1] ?? word;
}

function wordsOf(idea: KnownIdea): ReadonlySet<string> {
  return new Set(
    normaliseWords(`${idea.title} ${idea.toShoot}`)
      .split(' ')
      .filter((word) => word.length >= 3 && !SMALL_WORDS.has(word))
      .map(stemOf),
  );
}

export function tooClose(a: KnownIdea, b: KnownIdea): boolean {
  if (a.category === b.category && a.signalId === b.signalId) return true;
  const left = wordsOf(a);
  const right = wordsOf(b);
  if (left.size === 0 || right.size === 0) return false;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / (left.size + right.size - shared) >= CLOSE_WORDS_OVERLAP;
}

/** Every entry of her limits an idea is read against: what she never does, shows or says, and what disgusts her. */
function limitTerms(limits: PersonaLimits): readonly string[] {
  return [...limits.never_do, ...limits.never_show, ...limits.never_say, ...limits.disgusts];
}

/** The fields of an idea or of a shoot suggested by hand that the guards read, each on its own to name the one at fault. */
type GuardedField = 'title' | 'toShoot' | 'reason' | 'purpose' | 'hook' | 'onScreen' | 'shots' | 'ending';

export interface GuardedText {
  readonly field: GuardedField;
  readonly text: string;
}

/**
 * What an idea's own text breaks, whoever wrote it: her limits, « jamais de nu » for a public output, the Instagram
 * guard; with the field at fault (`null` without a persona, where no field is).
 */
export type GuardFault =
  | { readonly reason: 'no_persona'; readonly field: null }
  | { readonly reason: 'limit'; readonly term: string; readonly field: GuardedField }
  | { readonly reason: 'nudity'; readonly word: string; readonly field: GuardedField }
  | { readonly reason: 'instagram_guard'; readonly field: GuardedField };

/** The texts of a reel sheet (ADR 0082 § 3), read by the guards like the rest of the idea. */
export function reelBriefTexts(brief: ReelBrief | null): readonly GuardedText[] {
  if (brief === null) return [];
  return [
    { field: 'hook', text: brief.hook },
    ...(brief.onScreen === null ? [] : [{ field: 'onScreen' as const, text: brief.onScreen }]),
    { field: 'shots', text: brief.shots.join('\n') },
    ...(brief.ending === null ? [] : [{ field: 'ending' as const, text: brief.ending }]),
  ];
}

/**
 * The guards a text of a drop category is read against, the same each time: her limits first, then « jamais de nu »
 * for a public output, then the Instagram guard; each reads every field before the next one, in the given order.
 */
export function textsGuardFault(
  texts: readonly GuardedText[],
  category: IdeaDropCategory,
  limits: PersonaLimits | null,
  touches: (text: string, term: string) => boolean,
): GuardFault | null {
  // No persona, no idea: nothing can tell what touches her.
  if (limits === null) return { reason: 'no_persona', field: null };
  const terms = limitTerms(limits);
  for (const { field, text } of texts) {
    const term = terms.find((entry) => touches(text, entry));
    if (term !== undefined) return { reason: 'limit', term, field };
  }
  if (PUBLIC_DROP_CATEGORIES.has(category))
    for (const { field, text } of texts) {
      const word = nudityIn(text);
      if (word !== null) return { reason: 'nudity', word, field };
    }
  if (INSTAGRAM_DROP_CATEGORIES.has(category))
    for (const { field, text } of texts)
      if (instagramFaults(text).length > 0) return { reason: 'instagram_guard', field };
  return null;
}

/**
 * The guards an idea's text is read against, as the model wrote it or as the agency corrected it (« Idées du jour »,
 * ADR 0060 § 5): the same reading both times, so that a correction never sends what the filters would have dropped.
 * Its reel sheet is read with it (ADR 0082 § 3).
 */
export function guardFaultOf(
  idea: Pick<ContentIdeaDraft, 'title' | 'category' | 'toShoot' | 'reason' | 'reelBrief'>,
  limits: PersonaLimits | null,
  touches: (text: string, term: string) => boolean,
): GuardFault | null {
  return textsGuardFault(
    [
      { field: 'title', text: idea.title },
      { field: 'toShoot', text: idea.toShoot },
      { field: 'reason', text: idea.reason },
      ...reelBriefTexts(idea.reelBrief),
    ],
    idea.category,
    limits,
    touches,
  );
}

function dropOf(
  idea: ContentIdeaDraft,
  context: IdeaFilterContext,
  kept: readonly KnownIdea[],
): IdeaDrop | null {
  if (!context.liveSignals.has(idea.signalId)) return { reason: 'no_live_signal' };
  const fault = guardFaultOf(idea, context.limits, context.touches);
  if (fault !== null) return fault;
  if (context.refused.some((known) => tooClose(idea, known))) return { reason: 'refused_before' };
  if ([...context.recent, ...kept].some((known) => tooClose(idea, known))) return { reason: 'too_close' };
  if (kept.length >= CONTENT_IDEAS_PER_DAY_MAX) return { reason: 'over_daily_cap' };
  return null;
}

export interface FilteredIdeas {
  readonly kept: readonly ContentIdeaDraft[];
  readonly dropped: readonly { readonly idea: ContentIdeaDraft; readonly drop: IdeaDrop }[];
}

/** The day's ideas, in the model's order: each one also compared with those kept before it. */
export function filterIdeas(
  candidates: readonly ContentIdeaDraft[],
  context: IdeaFilterContext,
): FilteredIdeas {
  const kept: ContentIdeaDraft[] = [];
  const dropped: { idea: ContentIdeaDraft; drop: IdeaDrop }[] = [];
  for (const idea of candidates) {
    const drop = dropOf(idea, context, kept);
    if (drop === null) kept.push(idea);
    else dropped.push({ idea, drop });
  }
  return { kept, dropped };
}
