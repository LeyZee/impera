/**
 * When each bubble of her answer appears, in ms from the moment the answer arrived: nobody sends three messages at
 * once (Charles, 16/11), she sends one, writes the next, sends it. The delays are her typing time per bubble as the
 * real send waits them (agent `bubbleDelays`); the first leaves when the answer does, as in production, its typing
 * already covered by the time the answer took.
 */
export function revealTimes(delaysMs: readonly number[]): number[] {
  const times: number[] = [];
  let at = 0;
  delaysMs.forEach((delay, i) => {
    if (i > 0) at += delay;
    times.push(at);
  });
  return times;
}
