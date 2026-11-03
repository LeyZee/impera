import type { PersonaLimits, ScriptSegment } from '@impera/contracts';
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
  access: 'paid',
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
      access: 'paid',
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

  it('reads a bridge’s teaser as a sentence she says: what she never says and what disgusts her', () => {
    const bridge = (teaser: string): ScriptSegment => ({
      kind: 'bridge',
      key: 'ab',
      from: 'a',
      to: 'b',
      teaser,
      mediaSlots: [],
    });
    const around = (teaser: string) =>
      disgustBlocks([stage('a', 'Salon'), bridge(teaser), stage('b', 'Lit')], limits);
    expect(around('Tu viens, chéri ?')).toEqual([
      { key: 'ab', stageName: 'Tu viens, chéri ?', term: 'chéri' },
    ]);
    expect(around('Et la crème chantilly ?')).toEqual([
      { key: 'ab', stageName: 'Et la crème chantilly ?', term: 'crème chantilly' },
    ]);
    // Not what she never shows: a teaser is said, not shot.
    expect(around('Mes pieds')).toEqual([]);
  });

  it('reads the hints of a bridge’s media slots as what she shoots: never does, never shows, disgusts', () => {
    const bridge: ScriptSegment = {
      kind: 'bridge',
      key: 'ab',
      from: 'a',
      to: 'b',
      teaser: 'La suite ?',
      mediaSlots: [
        { kind: 'image', optional: false, hint: 'Photo teasing, pieds en avant' },
        { kind: 'image', optional: true, hint: 'Une fessée' },
      ],
    };
    expect(disgustBlocks([stage('a', 'Salon'), bridge, stage('b', 'Lit')], limits)).toEqual([
      { key: 'ab', stageName: 'La suite ?', term: 'Fessée' },
      { key: 'ab', stageName: 'La suite ?', term: 'pieds' },
    ]);
    // What she never says is a teaser's matter, not a photo's.
    const said: ScriptSegment = {
      ...bridge,
      mediaSlots: [{ kind: 'image', optional: false, hint: 'chéri' }],
    };
    expect(disgustBlocks([said], limits)).toEqual([]);
  });
});
