import type { FanAvailabilityRecord } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { TurnReading } from '../turn-briefs';
import { availabilityTurnOf, scriptsBoughtOf, sexAllowedOf, standingFactsOf } from '../turn-moment';

const NOW = new Date('2026-11-20T21:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const SITUATION = {
  now: NOW,
  timeZone: 'Europe/Paris',
  relationshipStartedAt: minutesAgo(600),
  spentCents: 0,
};

const HOT: TurnReading = {
  intent: 'sexting',
  sentiment: 'aroused',
  factsProposed: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Continuer.',
  toneHints: [],
  desireSignals: ['states_desire', 'alone', 'free_now'],
};

// An invented record: he said he is alone and free a few minutes ago.
const READY: FanAvailabilityRecord = {
  state: 'confirmed',
  signal: 'free_now',
  at: minutesAgo(5),
  expiresAt: new Date(NOW.getTime() + 2 * 3_600_000),
  seen: ['alone', 'free_now'],
  sexualizedAt: minutesAgo(5),
  askedAt: null,
  hotAt: minutesAgo(10),
};

const HISTORY = {
  scripts: [
    { scriptRef: 'a', sentStepIndexes: [0, 1], boughtStepIndexes: [1] },
    { scriptRef: 'b', sentStepIndexes: [0], boughtStepIndexes: [] },
  ],
};

describe('where he stands at a turn', () => {
  it('counts what he spent, how long they talked and the scripts he never entered', () => {
    expect(standingFactsOf({ ...SITUATION, lastSpentAt: null }, HISTORY)).toEqual({
      now: NOW,
      knownHours: 10,
      spentCents: 0,
      lastSpentAt: null,
      unenteredScripts: 1,
    });
    expect(standingFactsOf(SITUATION, null)).not.toHaveProperty('lastSpentAt');
    expect(scriptsBoughtOf(HISTORY)).toBe(1);
    expect(scriptsBoughtOf(undefined)).toBe(0);
  });

  it('allows nothing sexual without his adult age, in care, on a trap or with a risk', () => {
    const facts = { ageConfirmed: true, noExplicit: false, care: false, trapped: false };
    expect(sexAllowedOf(HOT, facts)).toBe(true);
    expect(sexAllowedOf(undefined, facts)).toBe(false);
    expect(sexAllowedOf(HOT, { ...facts, ageConfirmed: false })).toBe(false);
    expect(sexAllowedOf(HOT, { ...facts, care: true })).toBe(false);
    expect(sexAllowedOf({ ...HOT, risks: ['distress'] }, facts)).toBe(false);
  });

  it('reads his availability only with the brain’s reading and her threshold, and opens the gate', () => {
    const facts = {
      brief: HOT,
      fanText: 'Je suis seul chez moi',
      history: [{ from: 'fan' as const, text: 'Je suis seul chez moi', at: minutesAgo(1) }],
      situation: SITUATION,
      previous: READY,
      threshold: 60,
      heat: 90,
      scriptsBought: 0,
      sexAllowed: true,
      fanTier: undefined,
      random: () => 0.99,
    };
    const turn = availabilityTurnOf(facts);
    expect(turn.availability?.state).toBe('confirmed');
    expect(turn.scriptStart).toEqual({ open: true });
    expect(turn.availabilityKept).toMatchObject({ state: 'confirmed' });
    expect(availabilityTurnOf({ ...facts, threshold: undefined })).toEqual({
      availability: undefined,
      work: undefined,
      free: undefined,
      gateRecord: undefined,
      availabilityKept: undefined,
      scriptStart: undefined,
    });
  });
});
