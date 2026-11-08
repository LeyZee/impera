import type { ScriptDropSummary, ScriptSegment } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  dropContextOf,
  mediaHashOf,
  mentionsPrice,
  orderedSummary,
  scriptStepsOf,
  shownRow,
  validationRefusal,
  type ReviewedRow,
} from '../describe';

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

describe('the row a media is shown with, and what can be validated (ADR 0030 § 3)', () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 10, 8, 20, minute));
  const row = (
    id: string,
    created: number,
    validated: number | null,
    reasons: string[] = [],
  ): ReviewedRow => ({
    id,
    mediaAssetId: 'm1',
    reviewReasons: reasons,
    validatedAt: validated === null ? null : at(validated),
    createdAt: at(created),
  });

  it('shows the latest validated by its validation, else the latest written', () => {
    expect(shownRow([])).toBeNull();
    expect(shownRow([row('a', 1, null), row('b', 2, null)])?.id).toBe('b');
    // An older row validated wins over a newer one not validated.
    expect(shownRow([row('a', 1, 5), row('b', 2, null)])?.id).toBe('a');
    // Two validated: the latest validation, whatever was written first.
    expect(shownRow([row('a', 1, 9), row('b', 2, 6)])?.id).toBe('a');
    // Same instants: the greater id, as the base orders it.
    expect(shownRow([row('a', 1, null), row('b', 1, null)])?.id).toBe('b');
  });

  it('validates only the rows shown, and a row waiting for a human alone', () => {
    const shown = new Map<string, ReviewedRow>([
      ['m1', { ...row('a', 1, null, ['unsure']), mediaAssetId: 'm1' }],
      ['m2', { ...row('b', 1, null), mediaAssetId: 'm2' }],
    ]);
    const of = (id: string) => shown.get(id) ?? null;
    const a = shown.get('m1');
    const b = shown.get('m2');
    if (a === undefined || b === undefined) throw new Error('rows');
    expect(validationRefusal([b], of)).toBeNull();
    expect(validationRefusal([a], of)).toBeNull();
    expect(validationRefusal([a, b], of)).toBe('alone');
    expect(validationRefusal([{ ...b, id: 'older' }], of)).toBe('not_shown');
    // Already validated, its reasons no longer hold a batch.
    const settled = { ...a, validatedAt: at(3) };
    shown.set('m1', settled);
    expect(validationRefusal([settled, b], of)).toBeNull();
  });

  it('hashes a script by its slots, their media and the row each is told with, in any order', () => {
    const files = [
      { slotKey: 'salon::0', mediaAssetId: 'm1' },
      { slotKey: 'chambre:A:0', mediaAssetId: 'm2' },
    ];
    const told = new Map([
      ['m1', { descriptionId: 'd1' }],
      ['m2', { descriptionId: 'd2' }],
    ]);
    const hash = mediaHashOf(files, told);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(mediaHashOf([...files].reverse(), told)).toBe(hash);
    expect(mediaHashOf(files, new Map([...told, ['m2', { descriptionId: 'd3' }]]))).not.toBe(hash);
  });
});
