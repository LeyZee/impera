import type { PlaygroundAnswer, PlaygroundState } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { filedAck, rejectedWords, unansweredReason } from './model';

const REASONS: PlaygroundState['rejectReasons'] = [{ id: 'too_early_sexual', label: 'Trop sexuel trop tôt' }];

describe('the playground’s words', () => {
  it('says where a filed lesson went, and in the demo that nothing was filed', () => {
    expect(filedAck('rule', false)).toBe('Rangée en Règle : elle part au propriétaire pour validation.');
    expect(filedAck('rule', true)).toBe('Démo : rien n’est rangé pour de vrai.');
    expect(filedAck('voice_example', true)).toBe('Démo : rien n’est rangé pour de vrai.');
  });

  it('keeps the reason of a rejection in view, the note under it, since the reason decides the destination', () => {
    expect(
      rejectedWords({ kind: 'rejected', reason: 'too_early_sexual', note: 'il venait d’arriver' }, REASONS),
    ).toEqual({ reason: 'Trop sexuel trop tôt', note: 'il venait d’arriver' });
    expect(rejectedWords({ kind: 'rejected', reason: 'too_early_sexual', note: '  ' }, REASONS)).toEqual({
      reason: 'Trop sexuel trop tôt',
      note: null,
    });
  });
});

describe('unansweredReason (recette AGT 06/11)', () => {
  const blank: PlaygroundAnswer = {
    bubbles: [],
    isBlocked: true,
    violations: [],
    latencyMs: 0,
    costEur: 0,
    isFallback: false,
  };

  it('says why nothing was written: no model answered, or the day’s budget is spent', () => {
    expect(unansweredReason({ ...blank, failure: 'grok-4.7: unavailable' })).toBe(
      'aucun modèle IA n’a répondu, régénère dans un instant',
    );
    expect(unansweredReason({ ...blank, failure: 'plafond du jour atteint' })).toBe(
      'le budget IA du jour est atteint, rien ne s’écrit avant demain',
    );
  });

  it('leaves a sentence the guards stopped, and a written answer, to « Bloquée avant envoi »', () => {
    expect(unansweredReason(null)).toBeNull();
    expect(unansweredReason({ ...blank, isBlocked: false, failure: 'x' })).toBeNull();
    expect(unansweredReason({ ...blank, failure: 'x', bubbles: ['salut'] })).toBeNull();
    expect(
      unansweredReason({
        ...blank,
        failure: 'x',
        violations: [{ code: 'assistant_output', label: 'Répond comme un assistant', severity: 'blocking' }],
      }),
    ).toBeNull();
  });
});
