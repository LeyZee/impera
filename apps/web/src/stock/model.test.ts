import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  type ContentStock,
  type DropCategory,
  type StockCategory,
  type StockMedium,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { daysLabel, figuresOf, headlineOf, mediaCountOf, unitsOf } from './model';

const NOW = new Date('2026-11-21T12:00:00+01:00');

const category = (over: Partial<StockCategory> & Pick<StockCategory, 'category'>): StockCategory => ({
  platform: 'reveal',
  mode: 'days',
  unit: 'file',
  stockUnits: 7,
  stockMedia: 7,
  scheduledUnits: 0,
  outUnits7: 7,
  perWeek: 7,
  daysAhead: 7,
  target: 7,
  lacking: 0,
  status: 'ok',
  ...over,
});

let n = 0;
const medium = (category: DropCategory, standing: StockMedium['standing']): StockMedium => {
  n += 1;
  const id = `01a1feaf-0000-7000-8000-${String(n).padStart(12, '0')}`;
  return {
    dropId: ContentDropIdSchema.parse(id),
    fileId: ContentDropFileIdSchema.parse(id),
    category,
    kind: 'image',
    standing,
    droppedAt: '2026-11-20T10:00:00.000Z',
    outAt: standing === 'out' ? '2026-11-20T18:00:00.000Z' : null,
    description: 'validated',
    erasesAt: null,
    durationMs: null,
    notAGift: false,
  };
};

describe('Coffre Impera model', () => {
  it('counts the stock from one list: the headline and each category agree', () => {
    const stock: ContentStock = {
      asOf: NOW.toISOString(),
      categories: [category({ category: 'feed_shoot' })],
      media: [
        medium('feed_shoot', 'stock'),
        medium('feed_shoot', 'stock'),
        medium('feed_shoot', 'scheduled'),
        medium('feed_shoot', 'out'),
      ],
    };
    expect(mediaCountOf(stock, 'feed_shoot').inStock).toBe(2);
    expect(figuresOf(stock, NOW).inStock).toBe(2);
  });

  it('writes the unit and caps the days', () => {
    expect(unitsOf('feed_shoot', 1)).toBe('1 séance');
    expect(unitsOf('feed_shoot', 2)).toBe('2 séances');
    expect(daysLabel(4.6)).toBe('4,6 j');
    expect(daysLabel(20)).toBe('14 j +');
  });

  it('leads with the open platform that runs dry, never with one not open yet', () => {
    const stock: ContentStock = {
      asOf: NOW.toISOString(),
      categories: [
        category({ category: 'feed_video', stockUnits: 4, daysAhead: 4, lacking: 3, status: 'short' }),
        category({
          category: 'instagram_post',
          platform: 'instagram',
          stockUnits: 0,
          stockMedia: 0,
          outUnits7: 0,
          daysAhead: 0,
          lacking: 6,
          status: 'empty',
        }),
      ],
      media: [],
    };
    const headline = headlineOf(stock, NOW);
    expect(headline.tone).toBe('warn');
    expect(headline.title).toContain('Reveal');
    expect(headline.lead).toContain('3 vidéos');
  });
});
