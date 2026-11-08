import { FAN_CARD_FIELDS, type FanCardValue } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { ESSENTIALS, PANEL_GROUPS, restOf, sourceLine, valueText } from './card';

const now = new Date('2026-11-08T18:00:00Z');
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

  it('says where a value comes from, by name when a chatter noted it', () => {
    expect(sourceLine(value({}), now)).toBe('Dit par lui, il y a 3 jours');
    expect(sourceLine(value({ source: 'inferred', observedAt: '2026-11-08T15:00:00Z' }), now)).toBe(
      'Deviné, il y a 3 h',
    );
    expect(
      sourceLine(value({ source: 'noted', notedByName: 'Inès', observedAt: '2026-11-07T12:00:00Z' }), now),
    ).toBe('Noté par Inès, hier');
    expect(sourceLine(value({ source: 'noted' }), now)).toBe('Noté par un chatteur, il y a 3 jours');
  });

  it('reads a closed value by its label', () => {
    expect(valueText('intensity', ['naughty'])).toBe('Coquin');
    expect(valueText('outfits', ['lingerie noire', 'cosplay'])).toBe('lingerie noire · cosplay');
  });
});
