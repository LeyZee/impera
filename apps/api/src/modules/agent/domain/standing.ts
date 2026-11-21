/**
 * Where he stands with her (Charles 21/11): a fan who paid, a fan still new to her, or a confirmed time-waster (weeks
 * of talk, nothing paid). Code decides it from facts, never the brain; the time-waster span is the agency's setting,
 * and without it nobody is one (fail safe: he is treated as new).
 */
export type FanStanding = 'payer' | 'new' | 'time_waster';

export interface StandingLimits {
  /** Known this many hours with nothing paid: a confirmed time-waster. */
  readonly timeWasterHours: number;
}

export function fanStanding(
  fan: { readonly knownHours: number; readonly hasBought: boolean },
  limits?: StandingLimits,
): FanStanding {
  if (fan.hasBought) return 'payer';
  return limits !== undefined && fan.knownHours >= limits.timeWasterHours ? 'time_waster' : 'new';
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
  return standing === 'time_waster' ? 'mock' : 'calm_down';
}

/**
 * He asks her for a proof she is real (Charles 21/11): passed on to her, or put off lightly, for everyone but a
 * confirmed time-waster, who gets nothing and an annoyed answer. Never a price.
 */
export type ProofAnswer = 'relay' | 'refuse';

export function proofAnswer(standing: FanStanding): ProofAnswer {
  return standing === 'time_waster' ? 'refuse' : 'relay';
}
