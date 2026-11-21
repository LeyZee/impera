import { describe, expect, it } from 'vitest';

import { reconcilePlaced } from '../reconcile';

/* Invented bubbles (ADR 0010). */
describe('reconcilePlaced (ADR 0086 § 5, EXT-02)', () => {
  it('validates a draft sent word for word, whatever the spaces the platform gives back', () => {
    expect(reconcilePlaced(['coucou toi 😘'], ['coucou toi 😘'])).toEqual({ kind: 'approved' });
    expect(reconcilePlaced(['coucou  toi'], [' coucou toi\n'])).toEqual({ kind: 'approved' });
    // An accent written in its decomposed form is the same word.
    expect(reconcilePlaced(['été'], ['été'])).toEqual({ kind: 'approved' });
  });

  it('corrects it with what really left when he retouched it', () => {
    expect(reconcilePlaced(['coucou toi'], ['coucou mon cœur'])).toEqual({
      kind: 'edited',
      bubbles: ['coucou mon cœur'],
    });
  });

  it('waits for every bubble of a draft sent one at a time, then decides on all of them', () => {
    const bubbles = ['première', 'deuxième'];
    expect(reconcilePlaced(bubbles, ['première'])).toEqual({ kind: 'wait' });
    expect(reconcilePlaced(bubbles, ['première', 'deuxième'])).toEqual({ kind: 'approved' });
    expect(reconcilePlaced(bubbles, ['première !', 'la deuxième'])).toEqual({
      kind: 'edited',
      bubbles: ['première !', 'la deuxième'],
    });
  });
});
