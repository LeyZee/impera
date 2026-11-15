import { describe, expect, it } from 'vitest';

import { gapNote, gapNotes, spanLabel, timingLines } from './elapsed';

const TZ = 'Europe/Paris';
// Paris in November is UTC+1.
const at = (local: string): Date => new Date(`${local}+01:00`);

describe('spanLabel', () => {
  it('says a span as she would', () => {
    expect(spanLabel(30_000)).toBe('moins d’une minute');
    expect(spanLabel(12 * 60_000)).toBe('12 min');
    expect(spanLabel(3 * 3_600_000)).toBe('3 h');
    expect(spanLabel(47 * 3_600_000)).toBe('47 h');
    expect(spanLabel(5 * 86_400_000)).toBe('5 jours');
    expect(spanLabel(15 * 86_400_000)).toBe('2 semaines');
    expect(spanLabel(95 * 86_400_000)).toBe('3 mois');
  });
});

describe('gapNote', () => {
  it('says nothing under an hour', () => {
    expect(gapNote(at('2026-11-10T19:00:00'), at('2026-11-10T19:59:00'), TZ)).toBeNull();
  });

  it('dates a gap within her day by its length and her clock', () => {
    expect(gapNote(at('2026-11-10T16:00:00'), at('2026-11-10T19:10:00'), TZ)).toBe('3 h plus tard, 19 h 10');
  });

  it('calls the next date on her calendar the next day, even after a few hours', () => {
    expect(gapNote(at('2026-11-10T23:30:00'), at('2026-11-11T08:00:00'), TZ)).toBe(
      'le lendemain, mercredi, 8 h',
    );
  });

  it('counts days on her calendar beyond that', () => {
    expect(gapNote(at('2026-11-10T22:00:00'), at('2026-11-14T14:00:00'), TZ)).toBe(
      '4 jours plus tard, samedi, 14 h',
    );
  });
});

describe('gapNotes', () => {
  it('marks only his messages after a silence, and none without dates', () => {
    const notes = gapNotes(
      [
        { fromFan: true, at: at('2026-11-10T20:00:00') },
        { fromFan: false, at: at('2026-11-10T20:05:00') },
        { fromFan: true, at: at('2026-11-11T19:10:00') },
        { fromFan: false, at: at('2026-11-14T10:00:00') },
        { fromFan: true },
      ],
      TZ,
    );
    expect(notes).toEqual([null, null, 'le lendemain, mercredi, 19 h 10', null, null]);
  });
});

describe('timingLines', () => {
  const now = at('2026-11-11T19:30:00');

  it('says nothing without dates', () => {
    expect(timingLines([{ fromFan: false }, { fromFan: true }], now)).toEqual([]);
  });

  it('says how long he took to answer her', () => {
    expect(
      timingLines(
        [
          { fromFan: false, at: at('2026-11-11T19:00:00') },
          { fromFan: true, at: at('2026-11-11T19:25:00') },
        ],
        now,
      ),
    ).toEqual(['Il a mis 25 min à te répondre.']);
  });

  it('says her answer stayed long without one, and that she answers late', () => {
    expect(
      timingLines(
        [
          { fromFan: false, at: at('2026-11-09T22:00:00') },
          { fromFan: true, at: at('2026-11-11T10:00:00') },
          { fromFan: true, at: at('2026-11-11T10:02:00') },
        ],
        now,
      ),
    ).toEqual([
      'Ta dernière réponse date d’il y a 45 h : il ne t’avait pas répondu depuis.',
      'Il t’a écrit il y a 9 h : tu lui réponds en retard.',
    ]);
  });

  it('on a follow-up, says how long her last message waits', () => {
    expect(
      timingLines(
        [
          { fromFan: true, at: at('2026-11-11T10:00:00') },
          { fromFan: false, at: at('2026-11-11T10:05:00') },
        ],
        now,
      ),
    ).toEqual(['Ta dernière réponse date d’il y a 9 h et il n’y a pas répondu.']);
  });
});
