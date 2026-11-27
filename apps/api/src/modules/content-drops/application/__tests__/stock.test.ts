import { describe, expect, it } from 'vitest';

import { contentStockOf, type StockRow } from '../stock';

const NOW = new Date('2026-11-21T12:00:00Z');

const gift = (n: number, intensity: string | null): StockRow => ({
  dropId: `01a1feaf-0000-7000-8000-00000000000${String(n)}`,
  fileId: `01a1feaf-0000-7000-8000-00000000010${String(n)}`,
  category: 'whale_gift',
  kind: 'image',
  dropState: 'ready',
  droppedAt: new Date('2026-11-20T12:00:00Z'),
  outAt: null,
  erasesAt: null,
  durationMs: null,
  description: intensity === null ? 'pending' : 'validated',
  intensity,
});

describe('contentStockOf: a whale gift counts once proven not nude (ADR 0163 § 3, relecture Médias)', () => {
  it('counts soft and suggestive gifts, flags the nude ones, leaves the undescribed out of the count', () => {
    const stock = contentStockOf(
      [gift(1, 'soft'), gift(2, 'suggestive'), gift(3, 'explicit'), gift(4, null)],
      NOW,
    );
    expect(stock.categories.find((one) => one.category === 'whale_gift')?.stockUnits).toBe(2);
    expect(stock.media.map((one) => one.notAGift)).toEqual([false, false, true, false]);
  });
});
