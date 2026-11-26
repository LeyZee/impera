/**
 * What an answer does to a message (trous béants n° 13): the first answer is written; the same words again are a replay
 * that changes nothing; other words on an answered message are refused, the first answer stands.
 */
export type AnswerOutcome = 'write' | 'replay' | 'conflict';

export function answerOutcome(current: string | null, answer: string): AnswerOutcome {
  if (current === null) return 'write';
  return current === answer ? 'replay' : 'conflict';
}
