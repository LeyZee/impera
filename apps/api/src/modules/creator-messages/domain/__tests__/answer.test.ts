import { describe, expect, it } from 'vitest';

import { answerOutcome } from '../answer';

describe('the owner’s answer to her message (trous béants n° 13)', () => {
  it('is written once, replayed with the same words, refused with others', () => {
    expect(answerOutcome(null, 'Oui, on en parle demain')).toBe('write');
    expect(answerOutcome('Oui, on en parle demain', 'Oui, on en parle demain')).toBe('replay');
    expect(answerOutcome('Oui, on en parle demain', 'Non')).toBe('conflict');
  });
});
