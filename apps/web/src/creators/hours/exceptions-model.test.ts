import { DEFAULT_AGENT_HOURS, type AgentHours } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  dateWords,
  dayWords,
  gridDays,
  endOf,
  fromToWords,
  openedBeyondWeek,
  rangeWords,
  spanWords,
} from './exceptions-model';

// Everything below is invented (ADR 0010).
const PARIS = 'Europe/Paris';
/** 9:00 to 1:00 the next day, every day. */
const DAYS: AgentHours = {
  ...DEFAULT_AGENT_HOURS,
  reply: {
    mode: 'slots',
    slots: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, startMinute: 540, endMinute: 60, enabled: true })),
  },
};
const flat = (text: string): string => text.replace(/\s/gu, ' ');

describe('her dated days in words (ADR 0148 § 3)', () => {
  it('says ranges, midnight as the end, and a day without its AI', () => {
    expect(flat(rangeWords({ startMinute: 1200, endMinute: 1440 }))).toBe('20 h – minuit');
    expect(
      flat(
        dayWords([
          { startMinute: 0, endMinute: 240 },
          { startMinute: 1230, endMinute: 1440 },
        ]),
      ),
    ).toBe('0 h – 4 h, 20 h 30 – minuit');
    expect(dayWords([])).toBe('Pas d’IA ce jour-là');
    expect(
      flat(
        fromToWords([
          { startMinute: 60, endMinute: 480 },
          { startMinute: 1320, endMinute: 1440 },
        ]),
      ),
    ).toBe('de 1 h à 8 h, de 22 h à minuit');
  });

  it('names the day against her today', () => {
    expect(dateWords('2026-11-20', '2026-11-20')).toBe('Aujourd’hui');
    expect(dateWords('2026-11-21', '2026-11-20')).toBe('Demain');
    expect(dateWords('2026-11-24', '2026-11-20')).toBe('mardi 24 nov.');
    // Friday 20/11: the grid starts on Monday 16/11, two weeks a page.
    expect(gridDays('2026-11-20', 0)[0]).toBe('2026-11-16');
    expect(gridDays('2026-11-20', 0).at(-1)).toBe('2026-11-29');
    expect(gridDays('2026-11-20', 1)[0]).toBe('2026-11-30');
    expect(spanWords('2026-11-16', '2026-11-29')).toBe('novembre');
    expect(spanWords('2026-11-30', '2026-12-13')).toBe('novembre – décembre');
  });

  it('a 0 h end is midnight', () => {
    expect(endOf(0)).toBe(1440);
    expect(endOf(600)).toBe(600);
  });
});

describe('openedBeyondWeek (Sécurité, #865)', () => {
  it('says the hours a day opens that her week keeps closed', () => {
    // Friday 20/11: her week is open from 0:00 to 1:00 (Thursday's slot) and from 9:00.
    expect(openedBeyondWeek(DAYS, PARIS, '2026-11-20', [{ startMinute: 0, endMinute: 480 }])).toEqual([
      { startMinute: 60, endMinute: 480 },
    ]);
    expect(openedBeyondWeek(DAYS, PARIS, '2026-11-20', [{ startMinute: 600, endMinute: 1440 }])).toEqual([]);
  });

  it('nothing beyond a week always open', () => {
    expect(
      openedBeyondWeek(DEFAULT_AGENT_HOURS, PARIS, '2026-11-20', [{ startMinute: 0, endMinute: 1440 }]),
    ).toEqual([]);
  });
});
