/**
 * When the AI proposes to mark a fan « fragile » (ADR 0085 § 9, lot b2): his strong attachment on his card, with a
 * sign of distress or his spending climbing fast. A proposal only: a human accepts it (`PUT /v1/fans/:id/flags`) or
 * sets it aside; nothing here ever sets the flag. The thresholds are the agency's rules, in code (CLAUDE.md § 3).
 */

const DAY_MS = 86_400_000;

export const FRAGILE_PROPOSAL = {
  /** A handoff for distress counts this long. */
  distressDays: 30,
  /** His spending of these last days… */
  recentDays: 7,
  /** …against his weekly average over the weeks before them. */
  baselineWeeks: 8,
  /** Climbing fast: at least this many times his weekly average… */
  spendRatio: 2,
  /** …and at least this much in euro cents. */
  spendFloorMinor: 5_000,
  /** A proposal set aside stays aside this long, unless a new sign of distress comes. */
  dismissedDays: 30,
} as const;

/** A sign that makes the proposal, as the line says it. */
export type FragileSign = 'distress' | 'spending';

/**
 * Words of his card, lower case and without accents: whole words, or the start of one where the pattern ends with
 * `\w*`. A closed list: a word it misses leaves the proposal out, and a human can still mark him by hand.
 */
const STRONG_ATTACHMENT =
  /\b(amour\w*|amoureu\w*|jalou\w*|possessi\w*|accro\w*|obsed\w*|obsession\w*|dependan\w*|je t ?aime|tu me manques?|tres attache\w*|fusionnel\w*)\b/u;
const DISTRESS_MOODS =
  /\b(seule?s?|solitude|isole\w*|deprim\w*|depression|triste\w*|detresse|angoiss\w*|anxi\w*|mal etre|desesp\w*|pleure\w*|suicid\w*|perdue?s?)\b/u;

/** Lower case, accents off, punctuation as spaces: « Très attaché, « tu me manques » » → `tres attache tu me manques`. */
function normalized(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export const strongAttachment = (value: string): boolean => STRONG_ATTACHMENT.test(normalized(value));
export const distressMood = (value: string): boolean => DISTRESS_MOODS.test(normalized(value));

/** What the database knows of one fan with an attachment on his card and no « fragile » yet. */
export interface FragileCandidate {
  readonly attachment: { readonly value: string; readonly at: Date };
  readonly moods: { readonly value: string; readonly at: Date } | null;
  /** His latest handoff for distress, any conversation of his. */
  readonly distressAt: Date | null;
  /** In euro cents, his dollars converted (none counted without a rate). */
  readonly spentRecentMinor: number;
  /** His latest purchase of those last days, `null` without one. */
  readonly lastSpentAt: Date | null;
  /** His whole spending over the weeks before, in euro cents. */
  readonly spentBaselineMinor: number;
  /** The latest time a human set the proposal aside. */
  readonly dismissedAt: Date | null;
}

export interface FragileProposal {
  readonly signs: readonly FragileSign[];
  /** Since when it waits: the latest sign, his latest purchase for his spending. */
  readonly since: Date;
}

/** The proposal for this fan now, or `null`. */
export function fragileProposal(fan: FragileCandidate, now: Date): FragileProposal | null {
  if (!strongAttachment(fan.attachment.value)) return null;
  const distressSince = now.getTime() - FRAGILE_PROPOSAL.distressDays * DAY_MS;
  const handoff =
    fan.distressAt !== null && fan.distressAt.getTime() >= distressSince ? fan.distressAt : null;
  const mood = fan.moods !== null && distressMood(fan.moods.value) ? fan.moods.at : null;
  const distressAt = [handoff, mood].reduce<Date | null>(
    (latest, at) => (at !== null && (latest === null || at > latest) ? at : latest),
    null,
  );
  const weekly = fan.spentBaselineMinor / FRAGILE_PROPOSAL.baselineWeeks;
  const spending =
    fan.spentRecentMinor >= FRAGILE_PROPOSAL.spendFloorMinor &&
    fan.spentRecentMinor >= FRAGILE_PROPOSAL.spendRatio * weekly;
  const signs: FragileSign[] = [
    ...(distressAt === null ? [] : ['distress' as const]),
    ...(spending ? ['spending' as const] : []),
  ];
  if (signs.length === 0) return null;
  if (fan.dismissedAt !== null) {
    const stillAside = now.getTime() - fan.dismissedAt.getTime() < FRAGILE_PROPOSAL.dismissedDays * DAY_MS;
    const newDistress = distressAt !== null && distressAt > fan.dismissedAt;
    if (stillAside && !newDistress) return null;
  }
  const latest = [distressAt, spending ? fan.lastSpentAt : null].reduce<Date | null>(
    (found, at) => (at !== null && (found === null || at > found) ? at : found),
    null,
  );
  return { signs, since: latest ?? now };
}

/** The line's sentence: why, and that only a human marks him. */
export function fragileWhy(signs: readonly FragileSign[]): string {
  const cause =
    signs.length === 2
      ? 'Il est très attaché, semble en détresse et dépense de plus en plus vite.'
      : signs[0] === 'distress'
        ? 'Il est très attaché et semble en détresse.'
        : 'Il est très attaché et dépense de plus en plus vite.';
  return `${cause} L’IA propose de le marquer fragile : à toi d’accepter ou d’écarter.`;
}
