import { describe, expect, it } from 'vitest';

import { AvailabilityWhenSchema, PlannedWhenSchema, withinAgendaReach } from './creator-tasks';

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

describe('her agenda’s reach (CREA-14): a year back, two years ahead', () => {
  const now = Date.parse('2026-11-05T12:00:00.000Z');

  it('takes a day or a start within reach, a routine always', () => {
    expect(withinAgendaReach({ kind: 'day', day: '2026-11-05' }, now)).toBe(true);
    expect(withinAgendaReach({ kind: 'day', day: '2025-11-10' }, now)).toBe(true);
    expect(withinAgendaReach({ kind: 'day', day: '2028-11-01' }, now)).toBe(true);
    expect(withinAgendaReach({ kind: 'routine', weekdays: [1] }, now)).toBe(true);
  });

  it('refuses 1900, 9999 and what lies past either end', () => {
    expect(withinAgendaReach({ kind: 'day', day: '1900-01-01' }, now)).toBe(false);
    expect(withinAgendaReach({ kind: 'day', day: '9999-12-31' }, now)).toBe(false);
    expect(withinAgendaReach({ kind: 'day', day: '2025-11-01' }, now)).toBe(false);
    expect(
      withinAgendaReach(
        { kind: 'timed', startsAt: '2028-11-10T10:00:00.000Z', endsAt: '2028-11-10T11:00:00.000Z' },
        now,
      ),
    ).toBe(false);
    expect(PlannedWhenSchema.safeParse({ kind: 'day', day: '1900-01-01' }).success).toBe(false);
  });
});
