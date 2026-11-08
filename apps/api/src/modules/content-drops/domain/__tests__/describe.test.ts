import type { ScriptSegment } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { dropContextOf } from '../describe';

/** Invented: a stage with an outfit and two media, a bridge with a teaser photo, a stage with two series. */
const segments: ScriptSegment[] = [
  {
    kind: 'stage',
    key: 'salon',
    name: 'Le salon',
    intention: 'Elle se dévoile un peu',
    access: 'free',
    mood: 'Joueuse',
    outfit: 'Robe rouge',
    place: 'Canapé',
    mediaSlots: [
      { kind: 'image', optional: false, hint: null },
      { kind: 'video', optional: false, hint: 'Elle tourne sur elle-même', minSeconds: 5, maxSeconds: 20 },
    ],
    variants: [],
  },
  {
    kind: 'bridge',
    key: 'vers-chambre',
    from: 'salon',
    to: 'chambre',
    teaser: 'La suite arrive',
    mediaSlots: [{ kind: 'image', optional: false, hint: null }],
  },
  {
    kind: 'stage',
    key: 'chambre',
    name: 'La chambre',
    intention: 'Elle se dévoile plus.',
    access: 'paid',
    mood: null,
    outfit: null,
    place: null,
    mediaSlots: [{ kind: 'image', optional: false, hint: null }],
    variants: [
      { letter: 'A', hint: 'Lumière tamisée' },
      { letter: 'B', hint: 'Plein jour' },
    ],
  },
];

describe('what the drop says of a media (ADR 0083 § 5)', () => {
  it('names her category as her screen does, and no step outside a script', () => {
    expect(dropContextOf('feed_shoot', null)).toEqual({ category: 'Feed · Séance boudoir', step: null });
  });

  it('gives a stage its number, its name, its card and the media’s place', () => {
    expect(dropContextOf('script', { slotKey: 'salon::1', segments })).toEqual({
      category: 'Script',
      step: {
        number: 1,
        name: 'Le salon',
        instruction:
          'Elle se dévoile un peu. Joueuse. Tenue : Robe rouge. Lieu : Canapé. Elle tourne sur elle-même.',
        position: 2,
        count: 2,
      },
    });
  });

  it('gives a series its own hint', () => {
    expect(dropContextOf('script', { slotKey: 'chambre:B:0', segments }).step).toEqual({
      number: 2,
      name: 'La chambre',
      instruction: 'Elle se dévoile plus. Série B : Plein jour.',
      position: 1,
      count: 1,
    });
  });

  it('gives a bridge the stage it leaves and its teaser', () => {
    expect(dropContextOf('script', { slotKey: 'vers-chambre::0', segments }).step).toEqual({
      number: 1,
      name: 'Pont vers l’étape 2',
      instruction: 'La suite arrive.',
      position: 1,
      count: 1,
    });
  });

  it('gives no step for a slot the version does not have', () => {
    expect(dropContextOf('script', { slotKey: 'cuisine::0', segments })).toEqual({
      category: 'Script',
      step: null,
    });
  });
});
