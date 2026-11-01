import { describe, expect, it } from 'vitest';

import {
  addDays,
  cityOf,
  clockAt,
  clockOf,
  dayMonth,
  dayNumber,
  dayOf,
  fullDay,
  inputOf,
  lengthOf,
  longDay,
  minuteOf,
  minuteOfInput,
  mondayOf,
  rangeAt,
  shortDay,
  untilOf,
  weekdayOf,
  weekLabel,
  weekOf,
  zonedInstant,
} from './time';

const PARIS = 'Europe/Paris';
const PORTO_NOVO = 'Africa/Porto-Novo';

describe('wall-clock time', () => {
  it('reads an instant in the zone that shows it', () => {
    expect(dayOf('2026-10-28T23:30:00Z', PARIS)).toBe('2026-10-29');
    expect(minuteOf('2026-10-28T23:30:00Z', PARIS)).toBe(30);
    expect(clockAt('2026-10-28T23:00:00Z', PORTO_NOVO)).toBe('0 h');
    expect(rangeAt('2026-10-28T17:00:00Z', '2026-10-28T23:00:00Z', PARIS)).toBe('18 h – 0 h');
  });

  it('turns a day and an hour of a zone into its instant, the next day past midnight', () => {
    expect(zonedInstant('2026-10-28', 18 * 60, PARIS).toISOString()).toBe('2026-10-28T17:00:00.000Z');
    expect(zonedInstant('2026-10-28', 1440, PARIS).toISOString()).toBe('2026-10-28T23:00:00.000Z');
    expect(zonedInstant('2026-10-28', 23 * 60, PORTO_NOVO).toISOString()).toBe('2026-10-28T22:00:00.000Z');
  });

  it('takes the first of the two autumn hours, and the first instant after the spring gap', () => {
    // 25 October 2026: 02:30 happens twice in Paris, at +02:00 then at +01:00.
    expect(zonedInstant('2026-10-25', 150, PARIS).toISOString()).toBe('2026-10-25T00:30:00.000Z');
    // 29 March 2026: 02:30 does not exist in Paris; the clock goes from 02:00 to 03:00.
    expect(zonedInstant('2026-03-29', 150, PARIS).toISOString()).toBe('2026-03-29T01:00:00.000Z');
  });

  it('keeps a 6-hour night slot on its wall-clock hours when the clock changes: 7 h that night', () => {
    const start = zonedInstant('2026-10-25', 0, PARIS);
    const end = zonedInstant('2026-10-25', 360, PARIS);
    expect(lengthOf(end.getTime() - start.getTime())).toBe('7 h');
  });
});

describe('days and weeks', () => {
  it('walks the calendar and finds the week', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(weekdayOf('2026-11-01')).toBe(7);
    expect(mondayOf('2026-10-28')).toBe('2026-10-26');
    expect(weekOf('2026-10-26').at(-1)).toBe('2026-11-01');
    expect(weekLabel('2026-10-26')).toBe('26 oct. – 1er nov.');
    expect(dayMonth('2026-11-01')).toBe('dim. 1er nov.');
    expect(dayMonth('2026-11-11')).toBe('mer. 11 nov.');
    // PAIE-19: the first of a month is « 1er » in every format; a calendar's column keeps the number alone.
    expect(shortDay('2026-11-01')).toBe('dim. 1er');
    expect(shortDay('2026-11-11')).toBe('mer. 11');
    expect(fullDay('2026-11-01')).toBe('1er novembre 2026');
    expect(fullDay('2026-10-17')).toBe('17 octobre 2026');
    expect(dayNumber('2026-11-01')).toBe('1');
    expect(dayNumber('2026-11-11')).toBe('11');
    expect(longDay('2026-10-28')).toBe('mercredi 28 octobre');
    expect(longDay('2026-11-01')).toBe('dimanche 1er novembre');
  });
});

describe('words for time', () => {
  it('says hours the French way, and how long and how far', () => {
    expect(clockOf(23 * 60)).toBe('23 h');
    expect(clockOf(5 * 60 + 15)).toBe('5 h 15');
    expect(clockOf(1440)).toBe('0 h');
    expect(lengthOf(45 * 60_000)).toBe('45 min');
    expect(lengthOf(330 * 60_000)).toBe('5 h 30');
    expect(untilOf(12 * 60_000)).toBe('dans 12 min');
    expect(untilOf(3 * 86_400_000)).toBe('dans 3 jours');
  });
});

describe('time fields', () => {
  it('reads and writes the hours of a time field, and ignores one half typed', () => {
    expect(inputOf(65)).toBe('01:05');
    expect(minuteOfInput('23:45')).toBe(1425);
    expect(minuteOfInput('')).toBeNull();
    expect(minuteOfInput('24:00')).toBeNull();
    // Typed by hand, on 24 hours: the field is text, never the browser's clock.
    expect(minuteOfInput('9:00')).toBe(540);
    expect(minuteOfInput(' 21h30 ')).toBe(1290);
    expect(minuteOfInput('21 h')).toBe(1260);
    expect(minuteOfInput('22')).toBe(1320);
    expect(minuteOfInput('7')).toBe(420);
    expect(minuteOfInput('24')).toBeNull();
    // The phone's number pad has neither « : » nor « h » (iOS): digits alone, the last two the minutes.
    expect(minuteOfInput('930')).toBe(570);
    expect(minuteOfInput('0930')).toBe(570);
    expect(minuteOfInput('2230')).toBe(1350);
    expect(minuteOfInput('2460')).toBeNull();
    expect(minuteOfInput('960')).toBeNull();
    expect(minuteOfInput('12345')).toBeNull();
    expect(minuteOfInput('9:')).toBeNull();
    expect(minuteOfInput('9:0')).toBeNull();
    expect(minuteOfInput('12:60')).toBeNull();
    expect(minuteOfInput('09:00 AM')).toBeNull();
  });
});

describe('cities', () => {
  it('names a zone by its city, in French, the same on every screen (CREA-27)', () => {
    expect(cityOf('Europe/Paris')).toBe('Paris');
    expect(cityOf('Europe/Brussels')).toBe('Bruxelles');
    expect(cityOf('Africa/Lome')).toBe('Lomé');
    expect(cityOf('America/Toronto')).toBe('Toronto');
    expect(cityOf('America/New_York')).toBe('New York');
  });
});
