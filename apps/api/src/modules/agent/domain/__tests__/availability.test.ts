import { describe, expect, it } from 'vitest';

import {
  asksAvailability,
  availabilityChanged,
  FAN_AVAILABILITY_TTL_MS,
  readAvailability,
  scriptStartGate,
  sexualizes,
  UNKNOWN_AVAILABILITY,
  type AvailabilityTurn,
  type FanAvailabilityRecord,
} from '../availability';

const NOW = new Date('2026-11-13T21:00:00Z');
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

const turn = (patch: Partial<AvailabilityTurn> = {}): AvailabilityTurn => ({
  previous: null,
  signals: [],
  sexualizes: false,
  desire: 50,
  threshold: 70,
  now: NOW,
  ...patch,
});

describe('readAvailability', () => {
  it('confirms once he said, in the session, that he is alone and free', () => {
    const alone = readAvailability(turn({ signals: ['alone'] }));
    expect(alone).toMatchObject({ state: 'unknown', signal: 'alone', seen: ['alone'] });
    const free = readAvailability(turn({ previous: alone, signals: ['free_now'], now: at(5) }));
    expect(free).toMatchObject({
      state: 'confirmed',
      signal: 'free_now',
      at: at(5),
      expiresAt: new Date(at(5).getTime() + FAN_AVAILABILITY_TTL_MS),
    });
  });

  it('does not confirm on « chez lui » alone: home is not « nobody there »', () => {
    expect(readAvailability(turn({ signals: ['at_home', 'free_now'] })).state).toBe('unknown');
    expect(readAvailability(turn({ signals: ['at_home', 'alone', 'free_now'] })).state).toBe('confirmed');
  });

  it('goes to « non » on someone beside him, an appointment or work, whatever he said with it', () => {
    for (const negative of ['someone_nearby', 'leaving_soon', 'busy_now']) {
      expect(readAvailability(turn({ signals: ['alone', 'free_now', negative] }))).toMatchObject({
        state: 'no',
        signal: negative,
        seen: [],
      });
    }
  });

  it('lifts a « non » only on what he says after it', () => {
    const no = readAvailability(turn({ signals: ['someone_nearby'] }));
    expect(readAvailability(turn({ previous: no, signals: ['free_now'], now: at(10) })).state).toBe(
      'unknown',
    );
    expect(readAvailability(turn({ previous: no, signals: ['alone', 'free_now'], now: at(10) })).state).toBe(
      'confirmed',
    );
  });

  it('lapses after 2 hours: a confirmation of the day before never opens a script today', () => {
    const confirmed = readAvailability(turn({ signals: ['alone', 'free_now'], sexualizes: true }));
    const later = readAvailability(turn({ previous: confirmed, now: at(121) }));
    expect(later).toMatchObject({ state: 'unknown', signal: null, seen: [], sexualizedAt: null });
  });

  it('resets the session when his heat, having reached her threshold, falls back under it (ADR 0098 § 12)', () => {
    const hot = readAvailability(turn({ signals: ['alone', 'free_now'], sexualizes: true, desire: 80 }));
    expect(hot.hotAt).toEqual(NOW);
    const stillHot = readAvailability(turn({ previous: hot, desire: 75, now: at(5) }));
    expect(stillHot).toMatchObject({ state: 'confirmed', hotAt: NOW, sexualizedAt: NOW });
    expect(readAvailability(turn({ previous: stillHot, desire: 60, now: at(10) }))).toEqual(
      UNKNOWN_AVAILABILITY,
    );
  });

  it('keeps a confirmation given before he was hot', () => {
    const confirmed = readAvailability(turn({ signals: ['alone', 'free_now'], desire: 30 }));
    expect(readAvailability(turn({ previous: confirmed, desire: 40, now: at(5) })).state).toBe('confirmed');
  });

  it('changes nothing when nothing of his is read', () => {
    const confirmed = readAvailability(turn({ signals: ['alone', 'free_now'] }));
    const same = readAvailability(turn({ previous: confirmed, signals: null, now: at(1) }));
    expect(availabilityChanged(confirmed, same)).toBe(false);
  });
});

describe('sexualizes', () => {
  it('reads his own sexualizing, not a plain flirt', () => {
    expect(sexualizes({ intent: 'flirt', sentiment: 'positive' })).toBe(false);
    expect(sexualizes({ intent: 'sexting', sentiment: 'positive' })).toBe(true);
    expect(sexualizes({ intent: 'chat', sentiment: 'aroused' })).toBe(true);
    expect(sexualizes({ intent: 'chat', sentiment: 'positive', desireSignals: ['states_desire'] })).toBe(
      true,
    );
    expect(sexualizes({ intent: 'chat', sentiment: 'positive', desireSignals: ['body_compliment'] })).toBe(
      false,
    );
  });
});

describe('scriptStartGate', () => {
  const ready: FanAvailabilityRecord = {
    ...UNKNOWN_AVAILABILITY,
    state: 'confirmed',
    sexualizedAt: NOW,
  };

  it('opens only on all three conditions', () => {
    expect(scriptStartGate(ready, 70, 70)).toEqual({ open: true });
  });

  it('lists every missing condition, in order', () => {
    expect(scriptStartGate(UNKNOWN_AVAILABILITY, 40, 70)).toEqual({
      open: false,
      missing: ['desire_below_threshold', 'not_sexualizing', 'availability_unconfirmed'],
    });
    expect(scriptStartGate({ ...ready, state: 'no' }, 80, 70)).toEqual({
      open: false,
      missing: ['availability_unconfirmed'],
    });
  });
});

describe('asksAvailability', () => {
  const hotUnknown: FanAvailabilityRecord = { ...UNKNOWN_AVAILABILITY, sexualizedAt: NOW };

  it('asks when his availability is all that is missing, once per session', () => {
    const gate = scriptStartGate(hotUnknown, 80, 70);
    expect(asksAvailability(hotUnknown, gate)).toBe(true);
    expect(asksAvailability({ ...hotUnknown, askedAt: at(-5) }, gate)).toBe(false);
  });

  it('does not ask a fan who is not hot, who does not sexualize, or who said no', () => {
    expect(asksAvailability(hotUnknown, scriptStartGate(hotUnknown, 50, 70))).toBe(false);
    expect(asksAvailability(UNKNOWN_AVAILABILITY, scriptStartGate(UNKNOWN_AVAILABILITY, 80, 70))).toBe(false);
    const no: FanAvailabilityRecord = { ...hotUnknown, state: 'no' };
    expect(asksAvailability(no, scriptStartGate(no, 80, 70))).toBe(false);
  });

  it('asks again in a new session: her question lapses with it', () => {
    const asked = readAvailability(
      turn({ previous: { ...hotUnknown, askedAt: NOW }, sexualizes: true, desire: 80, now: at(121) }),
    );
    expect(asked.askedAt).toBeNull();
  });
});
