import { normalise, normaliseWords, unmask, type SocialAccountUsage } from '@impera/contracts';

import { checkVoiceOutput, type GuardSettings, type GuardViolation } from './guards';
import { fixesSomething } from './places';

/**
 * « Ses comptes » and what she offers around her practice (ADR 0143 § C, D, F, bounds 18 to 23): code decides, never
 * the model, whether a user name may leave at this turn, and whether she may point him to her practice's account. Pure.
 */

/** One of her accounts as the agent reads it: only the ones the owner marked « l'agent peut le donner ». */
export interface ShareableAccount {
  readonly platform: string;
  readonly username: string;
  readonly usage: SocialAccountUsage;
}

const words = (text: string): string => ` ${normaliseWords(text)} `;

// He looks for one of her accounts: « t'as insta ? », « ton tiktok », « où je peux te suivre ».
const LOOKS_FOR_ACCOUNT =
  / (?:ton|ta|tes|t as|tu as|t es sur|tu es sur|sur quel|quel est ton) (?:un |une |des |ton |ta )?(?:insta|instagram|tiktok|tik tok|compte|comptes|reseau|reseaux|youtube|twitch|x|twitter) | (?:ou|comment) (?:je peux|on peut|puis je) te (?:suivre|trouver|voir en live)| tu fais des lives? /u;
const LIVES = / (?:live|lives|tiktok|tik tok|twitch|direct) /u;
const PERSONAL = / (?:perso|personnel|prive|vrai compte) /u;
// He really wants to learn or try her practice (§ 10): in so many words.
const WANTS_TO_TRY =
  / (?:apprendre|essayer|tester|m initier|initier|debuter|debutant|cours|atelier|ateliers|seance|seances|formation|stage|prendre des cours|me former) /u;

/** The use he looks for, or null when he asks for no account. `practiceNamed`: he speaks of her practice. */
export function accountAsked(fanText: string, practiceNamed: boolean): SocialAccountUsage | 'any' | null {
  const read = words(fanText);
  if (!LOOKS_FOR_ACCOUNT.test(read)) return null;
  if (practiceNamed) return 'practice';
  if (LIVES.test(read)) return 'lives';
  if (PERSONAL.test(read)) return 'personal';
  return 'any';
}

/** He really wants to learn or try the practice he speaks of (§ 10): never on a passing mention. */
export const wantsToTry = (fanText: string): boolean => WANTS_TO_TRY.test(words(fanText));

/** What cuts everything (§ 16, bounds 21 and 23): read by code at the decision, read again before the send. */
export interface AccountCuts {
  readonly care: boolean;
  readonly doNotContact: boolean;
  readonly salesFrozen: boolean;
  /** The brain reads a risk on him: a threat, insistence, harassment (bound 23). */
  readonly openRisk: boolean;
}

/** She was told already to point him to her practice within `ORIENTATION_COOLDOWN_DAYS` (bound 23). */
export const ORIENTATION_COOLDOWN_DAYS = 30;

export type AccountDecision =
  /** Nothing about an account at this turn. */
  | { readonly kind: 'none' }
  /** She tells him to type her stage name (§ 8): no user name leaves. */
  | { readonly kind: 'stage_name' }
  /** She gives this one, for the use he looks for (§ 8, bound 18). */
  | { readonly kind: 'give'; readonly account: ShareableAccount; readonly orient: boolean };

export function accountDecision(input: {
  readonly asked: SocialAccountUsage | 'any' | null;
  /** He speaks of her practice and wants to try or learn it (§ 10). */
  readonly interested: boolean;
  /** Her practice offers something around it (the sheet's `offers`). */
  readonly offers: boolean;
  readonly shareable: readonly ShareableAccount[];
  readonly cuts: AccountCuts;
  /** She pointed him to her practice's account within the cooldown (bound 23). */
  readonly orientedRecently: boolean;
}): AccountDecision {
  const { cuts } = input;
  if (cuts.care || cuts.doNotContact || cuts.salesFrozen || cuts.openRisk) return { kind: 'none' };
  const orient = input.interested && input.offers && !input.orientedRecently;
  const wanted: SocialAccountUsage | 'any' | null = orient ? 'practice' : input.asked;
  if (wanted === null) return { kind: 'none' };
  // Only for the use he looks for (§ 8): an « any » ask gets her stage name, never a pick of the model.
  const account = wanted === 'any' ? undefined : input.shareable.find((a) => a.usage === wanted);
  if (account === undefined) return input.asked === null ? { kind: 'none' } : { kind: 'stage_name' };
  return { kind: 'give', account, orient };
}

/** Her answer split into words, each without the punctuation at its edges: « nora_demo. » reads « nora_demo ». */
const nameWords = (text: string): string[] =>
  normalise(text)
    .split(/[^\p{L}\p{N}._-]+/u)
    .map((word) => word.replace(/^[._-]+|[._-]+$/gu, ''))
    .filter((word) => word !== '');

/** Letters and digits only: « nora_demo », « nora-demo » and « nora demo » all read « norademo ». */
const compact = (text: string): string => normalise(text).replace(/[^\p{L}\p{N}]+/gu, '');

/** A name this short is only matched as a whole word: glued from her words, it would block on chance. */
const COMPACT_MIN = 5;
/** How many neighbouring words one name may be spread over: « nora . demo . 92 ». */
const NAME_WINDOW = 4;

/** One of her names, as written, or spread over neighbouring words without its separators (bound 19). */
function nameIn(words: readonly string[], name: string): boolean {
  const whole = normalise(name).replace(/^@+/u, '');
  if (words.some((word) => word.replace(/^@+/u, '') === whole)) return true;
  const target = compact(name);
  if (target.length < COMPACT_MIN) return false;
  const pieces = words.map(compact);
  return pieces.some((_, start) => {
    let glued = '';
    for (const piece of pieces.slice(start, start + NAME_WINDOW)) {
      glued += piece;
      if (glued === target) return true;
      if (glued.length >= target.length) return false;
    }
    return false;
  });
}

/**
 * Every user name of hers in a text (bound 19): as a whole word, case, accents, look-alikes, a leading « @ » and the
 * punctuation around it aside, or spread over neighbouring words (« nora demo », « norademo », « nora-demo »), read
 * as written and with digits read as letters. The guard reads it against the one, if any, code allowed at this turn.
 */
export function usernamesIn(text: string, usernames: readonly string[]): string[] {
  const readings = [nameWords(text), nameWords(unmask(text))];
  return usernames.filter((name) => name !== '' && readings.some((words) => nameIn(words, name)));
}

// The words that name each platform in her answer: on the turn code gives an account, only its own pass (bound 19).
const PLATFORM_WORDS: Readonly<Record<string, readonly string[]>> = {
  instagram: ['instagram', 'insta', 'ig'],
  tiktok: ['tiktok', 'tik tok'],
  x: ['twitter'],
  youtube: ['youtube'],
  twitch: ['twitch'],
  other: [],
};

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Her answer as the contact guard reads it on the turn code gives `allowed` (bound 19): that user name, with or without
 * its « @ », and the words of its platform are taken out, so they alone pass; anything else of a contact still blocks.
 * With nothing allowed, the answer is read as written.
 */
export function withoutAllowedAccount(
  bubbles: readonly string[],
  allowed: ShareableAccount | null,
): readonly string[] {
  if (allowed === null) return bubbles;
  const words = [allowed.username, ...(PLATFORM_WORDS[allowed.platform] ?? [])]
    .map((word) => escape(normalise(word)))
    .join('|');
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}._-])@?(?:${words})(?![\\p{L}\\p{N}_-]|\\.[\\p{L}\\p{N}])`,
    'gu',
  );
  return bubbles.map((bubble) => normalise(bubble).replace(pattern, ' '));
}

/**
 * Bound 19: any user name of hers but the one code allowed at this turn blocks, as a contact. `usernames` are all of
 * hers, given to the agent or not.
 */
export function accountViolations(
  bubbles: readonly string[],
  usernames: readonly string[],
  allowed: ShareableAccount | null,
): GuardViolation[] {
  const others = usernames.filter(
    (name) => allowed === null || normalise(name) !== normalise(allowed.username),
  );
  return [...new Set(bubbles.flatMap((bubble) => usernamesIn(bubble, others)))].map((match) => ({
    code: 'contact_info',
    severity: 'blocking',
    match,
  }));
}

// Her answer says yes to a meeting (bound 29): at the head of a bubble, past an interjection (« oh oui carrément »,
// « mais oui bb »), or anywhere in so many words (« avec grand plaisir », « j'adorerais », « on se cale ça »).
const INTERJECTION = '(?:(?:oh|ah|oh la|mais|bah|ben|bon|hmm+|hum|alors|euh|eh|oui) )*';
const YES_AT_HEAD = new RegExp(
  `^${INTERJECTION}(?:oui|ouais|ouii+|ok|okay|d accord|dac|carrement|bien sur|pourquoi pas|ca marche|vas y|go|grave|evidemment|yes)\\b`,
  'u',
);
const YES_ANYWHERE =
  /\b(?:yes|evidemment|avec (?:grand |un grand )?plaisir|volontiers|j adorerais|je dis pas non|je ne dis pas non|on se cale|on s organise|on fixe|quand tu veux)\b/u;

/** One bubble read for a yes: words only, apostrophes and punctuation as spaces. */
const yesReading = (bubble: string): string =>
  normalise(bubble)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * Bound 29: when he asks to see her for real, a bubble that says yes blocks, as a promise of a meeting, whatever
 * follows; « trop tôt », « pas encore », a soft no and the daydream in the conditional (« un jour peut-être ») pass.
 * Every bubble is read.
 */
export function meetingYes(bubbles: readonly string[]): GuardViolation[] {
  for (const [bubbleIndex, bubble] of bubbles.entries()) {
    const read = yesReading(bubble);
    const match = YES_AT_HEAD.exec(read)?.[0] ?? YES_ANYWHERE.exec(read)?.[0];
    if (match !== undefined) return [{ code: 'meeting_promise', severity: 'blocking', bubbleIndex, match }];
  }
  return [];
}

/**
 * Bounds 22 and 29: on a turn where he asks to meet or she points him to her practice, a bubble that fixes something
 * (a date, a time, a place, a city, a price) blocks and is rewritten; the voice is told so too, but code holds it.
 */
export function fixedSomething(bubbles: readonly string[]): GuardViolation[] {
  const fixed = fixesSomething(bubbles);
  return fixed === null
    ? []
    : [{ code: 'meeting_promise', severity: 'blocking', bubbleIndex: fixed.index, match: fixed.match }];
}

/**
 * The contact guard with her accounts (bound 19): on the turn code gives one, its name and the words of its platform
 * pass and nothing else of a contact does; any other name of hers blocks, given to the agent or not.
 */
export function withAccountGuard(
  violations: readonly GuardViolation[],
  written: readonly string[],
  settings: GuardSettings,
  allowed: ShareableAccount | null,
  usernames: readonly string[],
): GuardViolation[] {
  const others = accountViolations(written, usernames, allowed);
  if (allowed === null) return [...violations, ...others];
  const contacts = checkVoiceOutput(withoutAllowedAccount(written, allowed), settings).filter(
    (violation) => violation.code === 'contact_info',
  );
  return [...violations.filter((violation) => violation.code !== 'contact_info'), ...contacts, ...others];
}
