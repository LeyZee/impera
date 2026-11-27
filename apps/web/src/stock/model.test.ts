import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  type ContentStock,
  type DropCategory,
  type StockCategory,
  type StockMedium,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  daysLabel,
  figuresOf,
  fillOf,
  headlineOf,
  herFocusOf,
  mediaCountOf,
  ringSub,
  unitsOf,
} from './model';

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

describe('ringSub', () => {
  it('counts a minimum against its target, and a bonus without one', () => {
    expect(ringSub(category({ category: 'script', mode: 'count', stockUnits: 4, target: 4 }))).toBe(
      '4 prêts sur 4',
    );
    expect(ringSub(category({ category: 'voice_beep', mode: 'count', stockUnits: 1, target: 1 }))).toBe(
      '1 prêt sur 1',
    );
    expect(ringSub(category({ category: 'script', mode: 'count', stockUnits: 0, target: 3 }))).toBe(
      '0 prêt sur 3',
    );
    expect(ringSub(category({ category: 'sale_video', mode: 'bonus', stockUnits: 3, target: null }))).toBe(
      `${unitsOf('sale_video', 3)} en stock`,
    );
  });
});

describe('her coffre says what Aujourd’hui says (recette du 27/11, MOD-01, MOD-02)', () => {
  const day = (videoDone: number) => ({
    day: '2026-11-27',
    today: '2026-11-27',
    lines: [
      {
        item: 'reveal_video' as const,
        platform: 'reveal' as const,
        label: 'Ta vidéo du jour sur Reveal',
        sheet: 'Une phrase.',
        target: 1,
        done: videoDone,
        essential: true,
        source: 'drop' as const,
      },
    ],
  });
  const stock: ContentStock = {
    asOf: NOW.toISOString(),
    categories: [
      category({ category: 'feed_video', stockUnits: 0, daysAhead: 0, lacking: 7, status: 'empty' }),
      category({
        category: 'feed_shoot',
        perWeek: 3,
        stockUnits: 1,
        daysAhead: 2,
        lacking: 2,
        status: 'short',
      }),
      category({ category: 'script', mode: 'count', stockUnits: 0, target: 3, lacking: 3, perWeek: null }),
    ],
    media: [],
  };

  it('asks her video of the day first, while her coffre has none for today', () => {
    const focus = herFocusOf(stock, day(0), 0);
    expect(focus).toMatchObject({ when: 'today', title: 'Ta vidéo du jour', category: 'feed_video' });
    expect(focus.bonus.map((one) => one.category)).toEqual(['feed_shoot']);
  });

  it('then speaks of her week, never of her day as done', () => {
    const focus = herFocusOf(stock, day(1), 0);
    expect(focus).toMatchObject({ when: 'week', category: 'feed_video' });
    expect(`${focus.title} ${focus.lead}`).not.toMatch(/journée/u);
  });

  it('claims no script of her while the agency asks none', () => {
    const asked = herFocusOf({ ...stock, categories: stock.categories.slice(2) }, day(1), 0);
    expect(asked.category).toBeNull();
    expect(herFocusOf({ ...stock, categories: stock.categories.slice(2) }, day(1), 1).category).toBe(
      'script',
    );
  });

  it('draws a ring without a target empty at nothing, never full (MOD-11)', () => {
    expect(fillOf(category({ category: 'sale_video', mode: 'bonus', stockUnits: 0, target: null }))).toBe(0);
    expect(fillOf(category({ category: 'sale_video', mode: 'bonus', stockUnits: 2, target: null }))).toBe(
      100,
    );
  });
});
