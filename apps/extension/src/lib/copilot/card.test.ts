import { FAN_CARD_FIELDS, type FanCardValue } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { ESSENTIALS, groupChecks, identityText, newestOf, PANEL_GROUPS, restOf, valueText } from './card';

const value = (patch: Partial<FanCardValue>): FanCardValue => ({
  items: ['Lyon'],
  source: 'declared',
  observedAt: '2026-11-05T18:00:00Z',
  notedBy: null,
  notedByName: null,
  sourceMessageId: null,
  sourceQuote: null,
  ...patch,
});

describe('the fan’s card in the panel (ADR 0086 § 10)', () => {
  it('puts the six essentials on top and every other field once in its group', () => {
    expect(ESSENTIALS).toEqual(['first_name', 'age', 'location', 'desires', 'limits', 'life_events']);
    const shown = [
      ...ESSENTIALS,
      ...PANEL_GROUPS.flatMap(({ group }) => restOf(group).map((spec) => spec.field)),
    ];
    expect(shown.toSorted()).toEqual(FAN_CARD_FIELDS.map((spec) => spec.field).toSorted());
  });

  it('reads a closed value by its label', () => {
    // In lower case, as every other value of the card.
    expect(valueText('intensity', ['naughty'])).toBe('coquin');
    expect(valueText('outfits', ['lingerie noire', 'cosplay'])).toBe('lingerie noire · cosplay');
  });

  // Recette du 16/11, EXT-04.
  it('says his age in years, and the rest of who he is as it was noted', () => {
    expect(identityText('age', ['34'])).toBe('34 ans');
    expect(identityText('age', ['la trentaine'])).toBe('la trentaine');
    expect(identityText('location', ['Lyon'])).toBe('Lyon');
  });

  it('finds the newest value of the card, none for an empty one', () => {
    expect(newestOf([])).toBeNull();
    expect(
      newestOf([
        { field: 'age', current: value({ observedAt: '2026-11-05T18:00:00Z' }), toCheck: [] },
        { field: 'job', current: value({ observedAt: '2026-11-07T18:00:00.000Z' }), toCheck: [] },
        { field: 'location', current: null, toCheck: [] },
      ]),
    ).toBe('2026-11-07T18:00:00.000Z');
  });

  // V-EXT-07: the fold that holds a field to check says how many; an essential on top counts in none.
  it('counts what waits for a chatter in each fold, never an essential', () => {
    const entries = [
      { field: 'job' as const, current: null, toCheck: [value({ source: 'inferred' })] },
      { field: 'location' as const, current: null, toCheck: [value({ source: 'inferred' })] },
    ];
    const group = FAN_CARD_FIELDS.find((spec) => spec.field === 'job')?.group;
    if (group === undefined) throw new Error('no group');
    expect(groupChecks(entries, group)).toBe(1);
    expect(PANEL_GROUPS.filter((g) => g.group !== group).map((g) => groupChecks(entries, g.group))).toEqual([
      0, 0,
    ]);
  });
});
