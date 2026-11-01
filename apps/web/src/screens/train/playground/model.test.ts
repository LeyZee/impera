import type { PlaygroundState } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { filedAck, rejectedWords } from './model';

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
