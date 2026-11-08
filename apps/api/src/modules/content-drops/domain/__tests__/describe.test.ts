import type { ScriptDropSummary, ScriptSegment } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { dropContextOf, mentionsPrice, orderedSummary, scriptStepsOf } from '../describe';

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

describe('the steps of her sent script (ADR 0083 § 6)', () => {
  const file = (slotKey: string, mediaAssetId: string) => ({ slotKey, mediaAssetId });

  it('groups the filled slots by step, in the script’s order, each series apart', () => {
    const steps = scriptStepsOf(segments, [
      file('chambre:B:0', 'm5'),
      file('salon::1', 'm2'),
      file('salon::0', 'm1'),
      file('vers-chambre::0', 'm3'),
      file('chambre:A:0', 'm4'),
    ]);

    expect(steps).toEqual([
      {
        step: 'salon:',
        code: 'E1',
        name: 'Le salon',
        card: 'Elle se dévoile un peu. Joueuse. Tenue : Robe rouge. Lieu : Canapé.',
        media: [file('salon::0', 'm1'), file('salon::1', 'm2')],
      },
      {
        step: 'vers-chambre:',
        code: 'P12',
        name: 'Pont vers l’étape 2',
        card: 'La suite arrive.',
        media: [file('vers-chambre::0', 'm3')],
      },
      {
        step: 'chambre:A',
        code: 'E2A',
        name: 'La chambre',
        card: 'Elle se dévoile plus. Série A : Lumière tamisée.',
        media: [file('chambre:A:0', 'm4')],
      },
      {
        step: 'chambre:B',
        code: 'E2B',
        name: 'La chambre',
        card: 'Elle se dévoile plus. Série B : Plein jour.',
        media: [file('chambre:B:0', 'm5')],
      },
    ]);
  });

  it('tells no step without media, and leaves out a slot the version does not have', () => {
    const steps = scriptStepsOf(segments, [file('salon::0', 'm1'), file('cuisine::0', 'm9')]);

    expect(steps.map((step) => [step.step, step.media.length])).toEqual([['salon:', 1]]);
  });
});

describe('the brain’s answer, held by the code (ADR 0083 § 6, ADR 0056 § 6)', () => {
  const told = (step: string) => ({
    step,
    overview: `Ce que montre ${step}.`,
    summary: `Résumé de ${step}.`,
  });
  const summary: ScriptDropSummary = {
    shootingContext: 'Un soir chez elle.',
    steps: [told('vers-chambre:'), told('salon:')],
  };

  it('puts the steps back in the script’s order', () => {
    expect(orderedSummary(['salon:', 'vers-chambre:'], summary)?.steps.map((one) => one.step)).toEqual([
      'salon:',
      'vers-chambre:',
    ]);
  });

  it('refuses a step missing, added or told twice', () => {
    expect(orderedSummary(['salon:', 'vers-chambre:', 'chambre:A'], summary)).toBeNull();
    expect(orderedSummary(['salon:'], summary)).toBeNull();
    expect(
      orderedSummary(['salon:', 'vers-chambre:'], { ...summary, steps: [told('salon:'), told('salon:')] }),
    ).toBeNull();
  });

  it('sees a sum or a currency anywhere, never a number alone', () => {
    expect(mentionsPrice(summary)).toBe(false);
    expect(mentionsPrice({ ...summary, shootingContext: 'Trois tenues, deux pièces, 12 vidéos.' })).toBe(
      false,
    );
    for (const text of ['Vendue 15 €.', 'Pour 20 euros.', 'Prix : 9,99 EUR.', 'À 30 balles.', '$12'])
      expect(
        mentionsPrice({ ...summary, steps: [told('salon:'), { ...told('vers-chambre:'), summary: text }] }),
      ).toBe(true);
  });
});
