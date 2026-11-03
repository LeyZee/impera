import { PlatformAccountIdSchema, type SlotVersionInput } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { effectiveAtOf } from '../slot-versions';

/* An invented account (ADR 0010). Paris is UTC+1 from 25/10/2026; Tuesday 3/11/2026, 13:20 in Paris. */
const NORA_REVEAL = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-000000000011');
const NOW = new Date('2026-11-03T12:20:00Z');
const PARIS = 'Europe/Paris';

/** Three créneaux of 8 h from `start` minutes after midnight. */
const eightFrom = (start: number): SlotVersionInput['slots'] =>
  [0, 1, 2].map((index) => ({
    startMinute: (start + index * 480) % 1440,
    endMinute: (start + (index + 1) * 480) % 1440,
    name: null,
  }));

const version = (patch: Partial<SlotVersionInput> = {}): SlotVersionInput => ({
  startsOn: '2026-11-09',
  slots: eightFrom(120),
  seats: [],
  ...patch,
});

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string') return error.code;
  }
  return 'none';
};

describe('when a version of the créneaux takes effect (ADR 0049 § 1)', () => {
  it('takes effect a Monday ahead at its first créneau’s start, in the grid’s zone', () => {
    expect(effectiveAtOf(version(), NOW, PARIS).toISOString()).toBe('2026-11-09T01:00:00.000Z');
    expect(effectiveAtOf(version(), NOW, 'Indian/Antananarivo').toISOString()).toBe(
      '2026-11-08T23:00:00.000Z',
    );
  });

  it('refuses a day that is no Monday, and a Monday whose start has passed', () => {
    expect(codeOf(() => effectiveAtOf(version({ startsOn: '2026-11-10' }), NOW, PARIS))).toBe(
      'slot_version_date_invalid',
    );
    expect(codeOf(() => effectiveAtOf(version({ startsOn: '2026-11-02' }), NOW, PARIS))).toBe(
      'slot_version_date_invalid',
    );
  });

  it('takes effect « tout de suite » at the next start of one of its créneaux, the one under way kept', () => {
    // 13:20: of 2 h, 10 h and 18 h, the next is 18 h today.
    expect(effectiveAtOf(version({ startsOn: null }), NOW, PARIS).toISOString()).toBe(
      '2026-11-03T17:00:00.000Z',
    );
    // At 23:30, 2 h tomorrow.
    const late = new Date('2026-11-03T22:30:00Z');
    expect(effectiveAtOf(version({ startsOn: null }), late, PARIS).toISOString()).toBe(
      '2026-11-04T01:00:00.000Z',
    );
    // On a start itself, the next one: never the instant now.
    const onStart = new Date('2026-11-03T17:00:00Z');
    expect(effectiveAtOf(version({ startsOn: null }), onStart, PARIS).toISOString()).toBe(
      '2026-11-04T01:00:00.000Z',
    );
  });

  it('holds the créneaux and the places again as the contract does', () => {
    const hole = [
      { startMinute: 0, endMinute: 480, name: null },
      { startMinute: 600, endMinute: 0, name: null },
    ];
    expect(codeOf(() => effectiveAtOf(version({ slots: hole }), NOW, PARIS))).toBe('request_invalid');
    const outside = [{ slotRank: 3, platformAccountId: NORA_REVEAL, seats: 2 as const }];
    expect(codeOf(() => effectiveAtOf(version({ seats: outside }), NOW, PARIS))).toBe('request_invalid');
    const twice = [
      { slotRank: 1, platformAccountId: NORA_REVEAL, seats: 2 as const },
      { slotRank: 1, platformAccountId: NORA_REVEAL, seats: 1 as const },
    ];
    expect(codeOf(() => effectiveAtOf(version({ seats: twice }), NOW, PARIS))).toBe('request_invalid');
  });
});
