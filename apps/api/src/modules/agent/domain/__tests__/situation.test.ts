import { describe, expect, it } from 'vitest';

import { dayPart, describeSituation, isNight, localTime, nextLocalTime } from '../situation';

describe('situation', () => {
  it('reads her time in her own time zone', () => {
    const now = new Date('2026-10-17T21:30:00Z');
    expect(localTime(now, 'Europe/Paris').hour).toBe(23);
    expect(localTime(now, 'America/Montreal').hour).toBe(17);
    expect(localTime(now, 'Asia/Kolkata')).toMatchObject({ hour: 3, minute: 0 });
  });

  it('moves to the next time her clock shows, whatever the host time zone', () => {
    const now = new Date('2026-10-17T21:30:00Z');
    expect(nextLocalTime(now, 'Asia/Kolkata', 23, 15).toISOString()).toBe('2026-10-18T17:45:00.000Z');
    expect(nextLocalTime(now, 'Europe/Paris', 23, 30).toISOString()).toBe(now.toISOString());
  });

  it('lands on her clock across a daylight saving change', () => {
    // Paris goes from UTC+2 to UTC+1 on 25 October 2026 at 03:00.
    const now = new Date('2026-10-24T20:00:00Z');
    const next = nextLocalTime(now, 'Europe/Paris', 9, 0);
    expect(localTime(next, 'Europe/Paris')).toMatchObject({ hour: 9, minute: 0 });
    expect(next.toISOString()).toBe('2026-10-25T08:00:00.000Z');
  });

  it('calls night from 22:00 to 06:59', () => {
    expect(dayPart(22 * 60)).toBe('night');
    expect(dayPart(3 * 60)).toBe('night');
    expect(dayPart(6 * 60 + 59)).toBe('night');
    expect(dayPart(7 * 60)).toBe('day');
    expect(dayPart(21 * 60 + 59)).toBe('day');
  });

  it('reads her night from her hours (P3-14)', () => {
    // 21:30 in Paris: day by default, night when hers starts at 21:00.
    const moment = {
      now: new Date('2026-10-27T20:30:00Z'),
      timeZone: 'Europe/Paris',
      relationshipStartedAt: new Date('2026-10-20T20:30:00Z'),
      spentCents: 0,
    };
    expect(isNight(moment)).toBe(false);
    const night = { startMinute: 21 * 60, endMinute: 6 * 60 };
    expect(isNight({ ...moment, night })).toBe(true);
    expect(describeSituation({ ...moment, night })).toContain('(nuit)');
  });

  it('writes the moment as facts: time, day or night, how long, what he spent', () => {
    const text = describeSituation({
      now: new Date('2026-10-17T21:30:00Z'),
      timeZone: 'Europe/Paris',
      relationshipStartedAt: new Date('2026-10-14T21:30:00Z'),
      spentCents: 4_500,
    });
    expect(text).toContain('samedi 23 h 30 (nuit)');
    expect(text).toContain('depuis 3 jours');
    expect(text).toContain('45,00 €');
  });
});
