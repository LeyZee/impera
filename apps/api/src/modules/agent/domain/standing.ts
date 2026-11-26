/**
 * Where he stands with her (ADR 0135, guide 26/11): a fan who pays, a fan still new to her, a time-waster, or a
 * proven one. Code decides it from facts at each message, never the brain: a purchase or a tip takes him out at once,
 * and stopping paying puts him back. The spans and counts are the agency's settings (ADR 0135 § 1), never numbers
 * written here; without them nobody is a time-waster (fail safe: he is treated as new).
 */
export type FanStanding = 'payer' | 'new' | 'time_waster' | 'proven_time_waster';

export interface StandingLimits {
  /** Scripts sent to him that he never entered (nothing bought) before he counts as a time-waster. */
  readonly minUnenteredScripts: number;
  /** Known this many hours with nothing paid on top: a proven time-waster, the only one refused a proof. */
  readonly provenHours: number;
  /**
   * Spending older than this no longer counts: a former buyer idle that long is no known payer. Absent, any spending
   * ever counts (ADR 0135 § 1, lifetime spend).
   */
  readonly recentSpendHours?: number;
}

export interface StandingFacts {
  readonly now: Date;
  readonly knownHours: number;
  /** What he spent with her, ever. */
  readonly spentCents: number;
  /** When he last paid (a step, a media, a tip); `null` never; absent, not known: his lifetime spend decides. */
  readonly lastSpentAt?: Date | null;
  /** Her scripts sent to him that he never entered. */
  readonly unenteredScripts: number;
}

const HOUR_MS = 3_600_000;

/** He paid, and recently enough to still count: a known payer (guide 26/11). */
export function paysNow(facts: StandingFacts, limits?: StandingLimits): boolean {
  if (facts.spentCents <= 0) return false;
  if (limits?.recentSpendHours === undefined || facts.lastSpentAt === undefined) return true;
  return (
    facts.lastSpentAt !== null &&
    facts.now.getTime() - facts.lastSpentAt.getTime() < limits.recentSpendHours * HOUR_MS
  );
}

export function fanStanding(facts: StandingFacts, limits?: StandingLimits): FanStanding {
  if (paysNow(facts, limits)) return 'payer';
  if (limits === undefined || facts.unenteredScripts < limits.minUnenteredScripts) return 'new';
  return facts.knownHours >= limits.provenHours ? 'proven_time_waster' : 'time_waster';
}

/**
 * An explicit photo of his, sent cold (Charles 21/11): a payer turns her on, a new fan is told to calm down with a
 * joke, a time-waster is mocked. Never anything sexual before his adult age is confirmed: a doubt on his age overrides
 * everything (the hold takes it before).
 */
export type ExplicitPhotoAnswer = 'turned_on' | 'calm_down' | 'mock';

export function explicitPhotoAnswer(standing: FanStanding, ageConfirmed: boolean): ExplicitPhotoAnswer {
  if (!ageConfirmed) return 'calm_down';
  if (standing === 'payer') return 'turned_on';
  return standing === 'new' ? 'calm_down' : 'mock';
}

/**
 * He asks her for a proof she is real (guide 26/11): free for a new fan, a payer, a big one; passed on or put off
 * lightly. Refused only to a proven time-waster, who gets nothing and an annoyed answer. Never a price.
 */
export type ProofAnswer = 'relay' | 'refuse';

export function proofAnswer(standing: FanStanding): ProofAnswer {
  return standing === 'proven_time_waster' ? 'refuse' : 'relay';
}
