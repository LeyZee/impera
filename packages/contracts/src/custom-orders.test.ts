import { describe, expect, it } from 'vitest';

import {
  CUSTOM_DETAIL_MAX,
  CustomOrderReadingFromModelSchema,
  CustomOrderReadingSchema,
  ESSENTIAL_DETAILS,
  supplementsIn,
} from './custom-orders';
import { CUSTOM_FORMATS } from './custom-prices';

describe('the reading of a custom order (ADR 0159 § A.2)', () => {
  it('normalises what a model writes: nulls, unknown keys and ids dropped, long details cut', () => {
    const read = CustomOrderReadingFromModelSchema.parse({
      format: 'video',
      supplements: ['sup_0000000a', 'not-an-id', 'sup_0000000a'],
      minutes: 999,
      details: { what: ` ${'x'.repeat(200)} `, when: null, unknown: 'Test', tone: '  ' },
    });
    expect(read).toEqual({
      format: 'video',
      supplements: ['sup_0000000a'],
      minutes: 240,
      details: { what: 'x'.repeat(CUSTOM_DETAIL_MAX) },
    });
    expect(CustomOrderReadingSchema.safeParse(read).success).toBe(true);
  });

  it('reads nothing from an empty or unknown answer, without failing', () => {
    expect(CustomOrderReadingFromModelSchema.parse({})).toEqual({
      format: null,
      supplements: [],
      minutes: null,
      details: {},
    });
    expect(CustomOrderReadingFromModelSchema.parse({ format: 'something else', minutes: 2.5 })).toMatchObject(
      {
        format: null,
        minutes: null,
      },
    );
  });

  it('keeps only the supplements offered on the turn', () => {
    const read = CustomOrderReadingSchema.parse({
      format: 'photo',
      supplements: ['sup_0000000a', 'sup_0000000b'],
      minutes: null,
      details: {},
    });
    expect(supplementsIn(read, ['sup_0000000b']).supplements).toEqual(['sup_0000000b']);
  });

  it('asks at most three essential details of any format', () => {
    for (const format of CUSTOM_FORMATS) expect(ESSENTIAL_DETAILS[format].length).toBeLessThanOrEqual(3);
  });
});
