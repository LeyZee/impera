/**
 * Calibration: each answer the team rates in the playground (spec moteur-ia/playground-entrainement.md).
 * One number matters, the validation rate: answers kept as written, out of the last rated ones.
 */
import {
  REJECT_REASONS,
  type AnswerVersion,
  type Destination,
  type RejectReason,
  type Verdict,
} from '@impera/contracts';

export { REJECT_REASONS };
export type { AnswerVersion, Destination, RejectReason, Verdict };

export const REJECT_REASON_LABELS: Readonly<Record<RejectReason, string>> = {
  sounds_ai: 'sonne IA',
  out_of_character: 'hors personnage',
  too_long: 'trop long',
  too_early_sexual: 'trop tôt sexuel',
  missed_sale: 'vente ratée',
  forgot_fact: 'a oublié un fait',
  other: 'autre',
};

// Short words typed in the terminal, then the full labels.
const REASON_WORDS: Readonly<Record<string, RejectReason>> = {
  ia: 'sounds_ai',
  perso: 'out_of_character',
  long: 'too_long',
  tot: 'too_early_sexual',
  vente: 'missed_sale',
  oubli: 'forgot_fact',
  autre: 'other',
};

export function parseRejectReason(word: string): RejectReason | undefined {
  const key = word
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
  return (
    REASON_WORDS[key] ??
    REJECT_REASONS.find(
      (r) =>
        REJECT_REASON_LABELS[r]
          .normalize('NFD')
          .replace(/\p{Diacritic}/gu, '')
          .toLowerCase() === key,
    )
  );
}

/**
 * « trop long c'est un roman » → too_long, with the rest as the note. The longest leading words that name a
 * reason win, so the full labels (several words) work as well as the short ones.
 */
export function parseRejection(text: string): { reason: RejectReason; note?: string } | undefined {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((w) => w !== '');
  for (let n = Math.min(words.length, 4); n > 0; n -= 1) {
    const reason = parseRejectReason(words.slice(0, n).join(' '));
    if (reason === undefined) continue;
    const note = words.slice(n).join(' ');
    return { reason, ...(note !== '' && { note }) };
  }
  return undefined;
}

/** A rule is what code must enforce (rule 3): timing, selling, memory. Style goes to the voice examples. */
const RULE_REASONS: readonly RejectReason[] = ['too_early_sexual', 'missed_sale', 'forgot_fact'];

export function suggestDestination(verdict: Verdict): Destination | undefined {
  if (verdict.kind === 'validated') return undefined;
  if (verdict.kind === 'corrected') return 'voice_example';
  return RULE_REASONS.includes(verdict.reason) ? 'rule' : 'test';
}

export function versionLabel(version: AnswerVersion): string {
  return `voix ${version.voicePrompt} · ${version.voiceModel}`;
}

export interface RatedAnswer {
  readonly at: string;
  readonly version: AnswerVersion;
  readonly verdict: Verdict;
}

export const RATE_TARGET = 0.8;
const WINDOW = 50;

export interface RateReading {
  readonly rate: number | undefined;
  readonly rated: number;
  readonly validated: number;
  readonly meetsTarget: boolean;
}

export function playgroundRate(ratings: readonly RatedAnswer[], window = WINDOW): RateReading {
  const last = ratings.slice(-window);
  const validated = last.filter((r) => r.verdict.kind === 'validated').length;
  const rate = last.length === 0 ? undefined : validated / last.length;
  return {
    rate,
    rated: last.length,
    validated,
    meetsTarget: rate !== undefined && rate >= RATE_TARGET,
  };
}

export interface RateReport {
  readonly current: RateReading & { readonly version: AnswerVersion | undefined };
  /** Change in points from the previous version, once both have ratings. */
  readonly trendPoints?: number;
  readonly previousVersion?: AnswerVersion;
}

const sameVersion = (a: AnswerVersion, b: AnswerVersion): boolean =>
  a.voicePrompt === b.voicePrompt && a.voiceModel === b.voiceModel;

/** The rate of the version in use (the latest rated), and its trend on the version rated before it. */
export function rateReport(ratings: readonly RatedAnswer[], current?: AnswerVersion): RateReport {
  const version = current ?? ratings.at(-1)?.version;
  if (version === undefined) return { current: { ...playgroundRate([]), version } };
  const mine = ratings.filter((r) => sameVersion(r.version, version));
  const now = playgroundRate(mine);
  const previous = ratings.filter((r) => !sameVersion(r.version, version)).at(-1)?.version;
  if (previous === undefined) return { current: { ...now, version } };
  const before = playgroundRate(ratings.filter((r) => sameVersion(r.version, previous)));
  return {
    current: { ...now, version },
    previousVersion: previous,
    ...(now.rate !== undefined &&
      before.rate !== undefined && { trendPoints: Math.round((now.rate - before.rate) * 100) }),
  };
}
