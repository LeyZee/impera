import { describe, expect, it } from 'vitest';

import { AvailabilityWhenSchema } from './creator-tasks';

const weekly = (startMinute: number, endMinute: number) => ({
  kind: 'weekly',
  weekday: 6,
  startMinute,
  endMinute,
});

describe('a weekly dispo (CR-05), on the midnight convention of scheduling', () => {
  it('takes minutes of the day, an end at or before the start being the next day’s', () => {
    expect(AvailabilityWhenSchema.safeParse(weekly(14 * 60, 20 * 60)).success).toBe(true);
    expect(AvailabilityWhenSchema.safeParse(weekly(22 * 60, 2 * 60)).success).toBe(true);
    expect(AvailabilityWhenSchema.safeParse(weekly(22 * 60, 0)).success).toBe(true);
    expect(AvailabilityWhenSchema.safeParse(weekly(9 * 60, 9 * 60)).success).toBe(true);
  });

  it('refuses a minute past the day, as the table does', () => {
    expect(AvailabilityWhenSchema.safeParse(weekly(22 * 60, 26 * 60)).success).toBe(false);
    expect(AvailabilityWhenSchema.safeParse(weekly(24 * 60, 2 * 60)).success).toBe(false);
  });
});
