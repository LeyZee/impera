/**
 * When each bubble of her answer appears, in ms from the moment the answer arrived: nobody sends three messages at
 * once (Charles, 16/11), she sends one, writes the next, sends it. The delays are her typing time per bubble as the
 * real send waits them; the time the server already took to write the answer counts toward the first bubble's.
 */
export function revealTimes(delaysMs: readonly number[], latencyMs: number): number[] {
  const times: number[] = [];
  let at = 0;
  delaysMs.forEach((delay, i) => {
    at += i === 0 ? Math.max(0, delay - latencyMs) : delay;
    times.push(at);
  });
  return times;
}
