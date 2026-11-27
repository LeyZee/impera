import { describe, expect, it } from 'vitest';

import { explicitPhotoAnswer, fanStanding, paysNow, proofAnswer, type StandingFacts } from '../standing';

const NOW = new Date('2026-11-26T21:00:00Z');
const DAY_MS = 86_400_000;
const LIMITS = { minUnenteredScripts: 3, provenHours: 500, recentSpendHours: 1_000 };
const facts = (over: Partial<StandingFacts> = {}): StandingFacts => ({
  now: NOW,
  knownHours: 10,
  spentCents: 0,
  unenteredScripts: 0,
  ...over,
});

describe('where he stands with her (ADR 0135, guide 26/11)', () => {
  it('is a payer while his spending is recent, and stops being one once he stops paying', () => {
    expect(
      fanStanding(facts({ spentCents: 900, lastSpentAt: new Date(NOW.getTime() - DAY_MS) }), LIMITS),
    ).toBe('payer');
    const idle = facts({
      spentCents: 900,
      lastSpentAt: new Date(NOW.getTime() - 90 * DAY_MS),
      unenteredScripts: 3,
    });
    expect(paysNow(idle, LIMITS)).toBe(false);
    expect(fanStanding(idle, LIMITS)).toBe('time_waster');
    // Without a recency setting, or without the date, any spending ever counts (ADR 0135 § 1).
    expect(paysNow(idle, { minUnenteredScripts: 3, provenHours: 500 })).toBe(true);
    expect(paysNow(facts({ spentCents: 900 }), LIMITS)).toBe(true);
  });

  it('is a time-waster past the scripts he never entered, a proven one past the span, new otherwise', () => {
    expect(fanStanding(facts({ unenteredScripts: 2 }), LIMITS)).toBe('new');
    expect(fanStanding(facts({ unenteredScripts: 3 }), LIMITS)).toBe('time_waster');
    expect(fanStanding(facts({ unenteredScripts: 3, knownHours: 600 }), LIMITS)).toBe('proven_time_waster');
    // Without the agency's settings, nobody is one.
    expect(fanStanding(facts({ unenteredScripts: 9, knownHours: 900 }))).toBe('new');
  });

  it('answers his explicit photo by where he stands, never sexual before his age is confirmed', () => {
    expect(explicitPhotoAnswer('payer', true)).toBe('turned_on');
    expect(explicitPhotoAnswer('new', true)).toBe('calm_down');
    expect(explicitPhotoAnswer('time_waster', true)).toBe('mock');
    expect(explicitPhotoAnswer('proven_time_waster', true)).toBe('mock');
    expect(explicitPhotoAnswer('payer', false)).toBe('calm_down');
  });

  it('passes his asking for a proof on, refused only to a proven time-waster', () => {
    expect(proofAnswer('new')).toBe('relay');
    expect(proofAnswer('payer')).toBe('relay');
    expect(proofAnswer('time_waster')).toBe('relay');
    expect(proofAnswer('proven_time_waster')).toBe('refuse');
  });

  it('wears her out at his second doubt and refuses the third, whoever he is (method § 10.25.1)', () => {
    expect(proofAnswer('payer', 1)).toBe('annoyed');
    expect(proofAnswer('new', 2)).toBe('refuse');
    expect(proofAnswer('payer', 2)).toBe('refuse');
  });

  it('makes a time-waster at once of his third doubt when he never paid, without any rule set', () => {
    expect(fanStanding(facts({ spentCents: 0, unenteredScripts: 0, proofAsksBefore: 2 }))).toBe(
      'proven_time_waster',
    );
    expect(fanStanding(facts({ spentCents: 0, unenteredScripts: 0, proofAsksBefore: 1 }))).toBe('new');
    expect(fanStanding(facts({ spentCents: 500, proofAsksBefore: 5 }))).toBe('payer');
  });
});
