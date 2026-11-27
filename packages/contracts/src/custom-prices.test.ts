import { describe, expect, it } from 'vitest';

import {
  CUSTOM_FORMATS,
  camKindOf,
  CUSTOM_PRICE_ERROR_CODES,
  CustomPriceGridSchema,
  StoredCustomPriceGridSchema,
  emptyCustomPriceGrid,
  quoteCustomOrder,
  readyVideoPriceMinor,
  type CustomPriceGrid,
} from './custom-prices';

/** A test grid: neutral round numbers, never the agency's prices (ADR 0010). */
function grid(): CustomPriceGrid {
  const empty = emptyCustomPriceGrid();
  return {
    formats: empty.formats.map((line) => {
      if (line.format === 'video')
        return { ...line, priceMinor: 10_000, includedMinutes: 5, extraMinutePercent: 10 };
      if (line.format === 'call') return { ...line, priceMinor: 300, minMinutes: 10 };
      if (line.format === 'video_call_sexual') return { ...line, offered: false };
      return { ...line, priceMinor: 2_000 };
    }),
    supplements: [
      { id: 'sup_0000000a', label: 'Test A', offered: true, percent: 50 },
      { id: 'sup_0000000b', label: 'Test B', offered: false, percent: null },
      { id: 'sup_0000000c', label: 'Test C', offered: true, percent: 10 },
      { id: 'sup_0000000d', label: 'Test D', offered: true, percent: null },
    ],
    readyVideos: [
      { id: 'rv_0000000a', label: 'Type A', offered: true, minMinor: 2_000, maxMinor: 4_000 },
      { id: 'rv_0000000b', label: 'Type B', offered: false, minMinor: 1_000, maxMinor: 1_000 },
    ],
  };
}

describe('the custom price grid (ADR 0159 § C)', () => {
  it('accepts the empty grid and a filled one', () => {
    expect(CustomPriceGridSchema.safeParse(emptyCustomPriceGrid()).success).toBe(true);
    expect(CustomPriceGridSchema.safeParse(grid()).success).toBe(true);
  });

  it('refuses a format out of order, a minimum on a video, a nameless supplement, a malformed id', () => {
    const base = grid();
    expect(CustomPriceGridSchema.safeParse({ ...base, formats: [...base.formats].reverse() }).success).toBe(
      false,
    );
    const formats = base.formats.map((line) => (line.format === 'video' ? { ...line, minMinutes: 3 } : line));
    expect(CustomPriceGridSchema.safeParse({ ...base, formats }).success).toBe(false);
    const nameless = [...base.supplements, { id: 'sup_ffffffff', label: ' ', offered: true, percent: 5 }];
    expect(CustomPriceGridSchema.safeParse({ ...base, supplements: nameless }).success).toBe(false);
    const malformed = [...base.supplements, { id: 'extra', label: 'Test E', offered: true, percent: 5 }];
    expect(CustomPriceGridSchema.safeParse({ ...base, supplements: malformed }).success).toBe(false);
  });

  it('refuses two supplements with the same name, whatever the case', () => {
    const base = grid();
    const twice = [...base.supplements, { id: 'sup_ffffffff', label: 'test a', offered: true, percent: 5 }];
    expect(CustomPriceGridSchema.safeParse({ ...base, supplements: twice }).success).toBe(false);
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of CUSTOM_PRICE_ERROR_CODES) expect(code).toMatch(/_(not_found|conflict)$/u);
  });
});

describe('quoteCustomOrder', () => {
  it('adds each supplement as a percent of the format, rounded to the euro', () => {
    const quote = quoteCustomOrder(grid(), {
      format: 'photo',
      supplements: ['sup_0000000a', 'sup_0000000c'],
    });
    expect(quote).toEqual({
      kind: 'price',
      totalMinor: 3_200,
      lines: [
        { kind: 'format', format: 'photo', amountMinor: 2_000 },
        { kind: 'supplement', id: 'sup_0000000a', percent: 50, amountMinor: 1_000 },
        { kind: 'supplement', id: 'sup_0000000c', percent: 10, amountMinor: 200 },
      ],
    });
  });

  it('prices a call by the minute, never under its minimum', () => {
    expect(quoteCustomOrder(grid(), { format: 'call', supplements: [], minutes: 4 })).toMatchObject({
      kind: 'price',
      totalMinor: 3_000,
    });
    expect(
      quoteCustomOrder(grid(), { format: 'call', supplements: ['sup_0000000a'], minutes: 20 }),
    ).toMatchObject({
      kind: 'price',
      totalMinor: 9_000,
    });
  });

  it('adds the minutes of a video over its included ones before the supplements', () => {
    const quote = quoteCustomOrder(grid(), { format: 'video', supplements: ['sup_0000000a'], minutes: 7 });
    // 100 € + 2 minutes × 10 % = 120 €, then Test A +50 % of 120 €.
    expect(quote).toMatchObject({ kind: 'price', totalMinor: 18_000 });
  });

  it('declines what she never does, format or supplement, before any price', () => {
    expect(quoteCustomOrder(grid(), { format: 'video_call_sexual', supplements: [] })).toEqual({
      kind: 'declined',
      by: 'video_call_sexual',
    });
    expect(quoteCustomOrder(grid(), { format: 'video', supplements: ['sup_0000000b'] })).toEqual({
      kind: 'declined',
      by: 'sup_0000000b',
    });
  });

  it('sends an order with an unpriced or unknown line off the grid, naming each', () => {
    expect(
      quoteCustomOrder(grid(), { format: 'photo', supplements: ['sup_0000000d', 'sup_99999999'] }),
    ).toEqual({
      kind: 'off_grid',
      missing: ['sup_0000000d', 'sup_99999999'],
    });
    expect(quoteCustomOrder(emptyCustomPriceGrid(), { format: 'photo', supplements: [] })).toEqual({
      kind: 'off_grid',
      missing: ['photo'],
    });
  });
});

describe('the videos already shot (ADR 0159 § C)', () => {
  it('reads a grid saved before the list existed as having none', () => {
    const { formats, supplements } = grid();
    const older = { formats, supplements };
    expect(CustomPriceGridSchema.parse(older).readyVideos).toEqual([]);
  });

  it('refuses a range upside down, under 1 €, a malformed id, two lines with one name', () => {
    const base = grid();
    const line = { id: 'rv_0000000c', label: 'Type C', offered: true, minMinor: 2_000, maxMinor: 3_000 };
    const refused = [
      { ...line, maxMinor: 1_000 },
      { ...line, minMinor: 50 },
      { ...line, id: 'rv_C' },
      { ...line, label: 'type a' },
    ];
    for (const bad of refused)
      expect(
        CustomPriceGridSchema.safeParse({ ...base, readyVideos: [...base.readyVideos, bad] }).success,
      ).toBe(false);
    expect(
      CustomPriceGridSchema.safeParse({ ...base, readyVideos: [...base.readyVideos, line] }).success,
    ).toBe(true);
  });

  it('draws a round price inside the range, the same for the same seed', () => {
    const range = { minMinor: 2_050, maxMinor: 4_000 };
    const drawn = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((seed) => readyVideoPriceMinor(range, seed));
    for (const price of drawn) {
      expect(price % 100).toBe(0);
      expect(price).toBeGreaterThanOrEqual(2_100);
      expect(price).toBeLessThanOrEqual(4_000);
    }
    expect(new Set(drawn).size).toBeGreaterThan(1);
    expect(readyVideoPriceMinor(range, 'a')).toBe(drawn[0]);
    expect(readyVideoPriceMinor({ minMinor: 1_000, maxMinor: 1_000 }, 'x')).toBe(1_000);
    expect(readyVideoPriceMinor({ minMinor: 1_020, maxMinor: 1_080 }, 'x')).toBe(1_020);
  });
});

describe('the dressed cam (Charles, 27/11)', () => {
  it('reads each video call’s kind; anything else is no cam', () => {
    expect(camKindOf('video_call_talk')).toBe('talk');
    expect(camKindOf('video_call_dressed')).toBe('dressed');
    expect(camKindOf('video_call_sexual')).toBe('sexual');
    expect(camKindOf('call')).toBeNull();
    expect(camKindOf(null)).toBeNull();
  });

  it('a grid saved before it reads with it, not offered and unpriced, in its place', () => {
    const saved = emptyCustomPriceGrid();
    const old = { ...saved, formats: saved.formats.filter((line) => line.format !== 'video_call_dressed') };
    expect(CustomPriceGridSchema.safeParse(old).success).toBe(false);
    const grid = StoredCustomPriceGridSchema.parse(old);
    expect(grid.formats.map((line) => line.format)).toEqual([...CUSTOM_FORMATS]);
    expect(grid.formats.find((line) => line.format === 'video_call_dressed')).toMatchObject({
      offered: false,
      priceMinor: null,
    });
  });
});
