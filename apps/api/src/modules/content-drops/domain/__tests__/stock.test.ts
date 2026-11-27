import { DROP_CATEGORIES } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { STOCK_ORDER, STOCK_RULES, platformDays, statusOf, stockCategory, type StockCounts } from '../stock';

const counts = (over: Partial<StockCounts> = {}): StockCounts => ({
  stockDrops: 0,
  stockFiles: 0,
  scheduledDrops: 0,
  scheduledFiles: 0,
  outDrops7: 0,
  outFiles7: 0,
  ...over,
});

describe('content-drops › Coffre Impera, her stock against the rhythm (ADR 0163)', () => {
  it('has a rule and a place on screen for every category', () => {
    expect([...STOCK_ORDER].sort()).toEqual([...DROP_CATEGORIES].sort());
    for (const category of DROP_CATEGORIES) expect(STOCK_RULES[category]).toBeDefined();
  });

  it('asks 7 days of advance on Reveal and 3 on Instagram', () => {
    const reveal = stockCategory('feed_video', counts({ stockDrops: 4, stockFiles: 4 }));
    expect(reveal).toMatchObject({
      mode: 'days',
      daysAhead: 4,
      target: 7,
      lacking: 3,
      status: 'short',
      perWeek: 7,
    });
    const insta = stockCategory('instagram_story', counts({ stockFiles: 11 }));
    expect(insta).toMatchObject({ daysAhead: 2.7, target: 3, lacking: 1, status: 'short', perWeek: 28 });
  });

  it('counts a boudoir session as one use, whatever its number of media', () => {
    const shoot = stockCategory(
      'feed_shoot',
      counts({ stockDrops: 2, stockFiles: 34, outDrops7: 3, outFiles7: 40 }),
    );
    expect(shoot).toMatchObject({
      unit: 'drop',
      stockUnits: 2,
      stockMedia: 34,
      outUnits7: 3,
      daysAhead: 4.6,
    });
    expect(shoot.lacking).toBe(1);
  });

  it('holds scripts and gifts against a minimum, not a pace', () => {
    expect(stockCategory('script', counts({ stockDrops: 2, stockFiles: 30 }))).toMatchObject({
      mode: 'count',
      daysAhead: null,
      target: 4,
      lacking: 2,
      status: 'short',
    });
    expect(stockCategory('whale_gift', counts({ stockFiles: 0 }))).toMatchObject({
      status: 'empty',
      lacking: 3,
    });
  });

  it('asks nothing of Telegram, which rides on the feed video', () => {
    expect(stockCategory('telegram_post', counts())).toMatchObject({
      mode: 'bonus',
      target: null,
      status: 'ok',
    });
  });

  it('asks no story of her: her Reveal story is the feed video with its own caption (Charles, 27/11)', () => {
    expect(stockCategory('reveal_story', counts())).toMatchObject({
      mode: 'bonus',
      target: null,
      lacking: 0,
      status: 'ok',
    });
  });

  it('says empty, low (under half), short, then ok', () => {
    expect(statusOf(0, 7)).toBe('empty');
    expect(statusOf(3, 7)).toBe('low');
    expect(statusOf(3.5, 7)).toBe('short');
    expect(statusOf(7, 7)).toBe('ok');
  });

  it('gives a platform the days of its weakest category', () => {
    const categories = [
      stockCategory('instagram_post', counts({ stockFiles: 5 })),
      stockCategory('instagram_story', counts({ stockFiles: 8 })),
      stockCategory('feed_video', counts({ stockFiles: 4 })),
    ];
    expect(platformDays(categories, 'instagram')).toBe(2);
    expect(platformDays(categories, 'reveal')).toBe(4);
    expect(platformDays(categories, 'telegram')).toBeNull();
  });
});
