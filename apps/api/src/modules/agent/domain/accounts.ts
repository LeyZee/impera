import { normaliseWords, type SocialAccountUsage } from '@impera/contracts';

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

/**
 * Every user name of hers in a text (bound 19), as whole words, case and a leading « @ » aside: the guard reads it
 * against the one, if any, code allowed at this turn.
 */
export function usernamesIn(text: string, usernames: readonly string[]): string[] {
  const read = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}._-]+/gu, ' ')} `;
  return usernames.filter((name) => name !== '' && read.includes(` ${name.toLowerCase()} `));
}
