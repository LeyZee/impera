/**
 * The gauge in the middle of the action (Charles 26/11): every few of her messages while her script runs, she checks
 * where he is, how hard he still is, in her own words and never the same; the cadence is code's, the words are hers.
 * Counted from the run's start: the count since the last gauge is that count past its last multiple.
 */
export const GAUGE_EVERY = 3;

/** Her messages since the run started; the gauge is due on each `GAUGE_EVERY`-th. */
export function gaugeDue(herMessagesSinceStart: number): boolean {
  return herMessagesSinceStart > 0 && herMessagesSinceStart % GAUGE_EVERY === 0;
}

/**
 * The projection on the media he sees (Charles 27/11 at 0:03): every few of her messages while her script runs, never on
 * each, she brings him back to what the step in front of him shows and makes him project himself into it. The words are
 * hers, the cadence is code's. Counted from the run's start; the gauge, when due, goes first.
 */
export const PROJECTION_EVERY = 2;

/** Her messages since the run started; the projection is due on the first and every `PROJECTION_EVERY`-th after. */
export function projectionDue(herMessagesSinceStart: number): boolean {
  return (
    herMessagesSinceStart > 0 &&
    herMessagesSinceStart % PROJECTION_EVERY === 1 % PROJECTION_EVERY &&
    !gaugeDue(herMessagesSinceStart)
  );
}

/**
 * He is about to come (Charles 26/11): she asks him to hold back, and no step goes on this message. The next one may go
 * once he answered after holding back without coming: then his message carries neither signal. She holds him back at
 * least until he has seen the frankest step of her script (`peakSeen`, amendement du 26/11); past it, she lets him go.
 */
export function holdsBackNow(signals: readonly string[] | undefined, peakSeen = false): boolean {
  return !peakSeen && signals?.includes('close_to_coming') === true && !signals.includes('just_came');
}
