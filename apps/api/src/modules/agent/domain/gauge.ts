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
 * He is about to come (Charles 26/11): she asks him to hold back, and no step goes on this message. The next one may go
 * once he answered after holding back without coming: then his message carries neither signal.
 */
export function holdsBackNow(signals: readonly string[] | undefined): boolean {
  return signals?.includes('close_to_coming') === true && !signals.includes('just_came');
}
