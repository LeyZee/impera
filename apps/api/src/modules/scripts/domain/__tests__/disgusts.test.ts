import type { PersonaLimits, ScriptSegment } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { disgustBlocks } from '../disgusts';

/** Invented limits: never a real persona in a test (CLAUDE.md). */
const limits: PersonaLimits = {
  never_do: ['Fessée'],
  never_show: ['pieds'],
  never_say: ['chéri'],
  disgusts: ['crème chantilly'],
};

const stage = (key: string, name: string, hint: string | null = null): ScriptSegment => ({
  kind: 'stage',
  key,
  name,
  intention: 'Elle se dévoile',
  mood: null,
  mediaSlots: [{ kind: 'image', optional: false, hint }],
  variants: [],
});

describe('disgustBlocks', () => {
  it('names the stage and the entry it touches', () => {
    expect(disgustBlocks([stage('a', 'Salon'), stage('b', 'Pieds nus')], limits)).toEqual([
      { key: 'b', stageName: 'Pieds nus', term: 'pieds' },
    ]);
  });

  it('reads the hints of the media slots and the variants, case and accents aside', () => {
    expect(disgustBlocks([stage('a', 'Cuisine', 'avec de la CREME chantilly')], limits)).toEqual([
      { key: 'a', stageName: 'Cuisine', term: 'crème chantilly' },
    ]);
    const variant: ScriptSegment = {
      kind: 'stage',
      key: 'v',
      name: 'Lit',
      intention: 'Elle se dévoile',
      mood: null,
      mediaSlots: [{ kind: 'image', optional: false, hint: null }],
      variants: [{ letter: 'A', hint: 'une fessée' }],
    };
    expect(disgustBlocks([variant], limits).map((block) => block.term)).toEqual(['Fessée']);
  });

  it('matches whole words only', () => {
    expect(disgustBlocks([stage('a', 'Trépied et lumière')], limits)).toEqual([]);
  });

  it('leaves out what she never says: a stage is shot, not said', () => {
    expect(disgustBlocks([stage('a', 'Chéri, regarde')], limits)).toEqual([]);
  });

  it('never reads a bridge', () => {
    const bridge: ScriptSegment = { kind: 'bridge', key: 'ab', from: 'a', to: 'b', teaser: 'Mes pieds' };
    expect(disgustBlocks([stage('a', 'Salon'), bridge, stage('b', 'Lit')], limits)).toEqual([]);
  });
});
