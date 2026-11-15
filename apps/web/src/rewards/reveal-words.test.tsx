// @vitest-environment jsdom
import { PayPeriodSchema } from '@impera/contracts';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { TROPHY_NAMES } from './TrophyBadge';
import { revealWordsOf, tierOfKind } from './reveal-words';

afterEach(cleanup);

const P = PayPeriodSchema.parse('2026-11-01');
const TIERS = [
  { thresholdMinor: 100_000, bonusMinor: 2_000, label: 'Bronze' },
  { thresholdMinor: 200_000, bonusMinor: 6_000, label: 'Or' },
];

describe('revealWordsOf (ADR 0104 § 12, § 15, § 17)', () => {
  it('names each trophy of the closed list, with no amount', () => {
    for (const [kind, name] of Object.entries(TROPHY_NAMES)) {
      const words = revealWordsOf({ kind }, P, TIERS);
      expect(words?.title).toBe(name);
      expect(words?.tone).toBe('neon');
      expect(words?.chip).toBeUndefined();
      expect(`${words?.title ?? ''} ${words?.text ?? ''}`).not.toMatch(/€|\$/u);
    }
    expect(revealWordsOf({ kind: 'streak_10' }, P, TIERS)?.kicker).toBe('Série');
    expect(revealWordsOf({ kind: 'first_sale' }, P, TIERS)?.kicker).toBe('Trophée gagné');
  });

  it('names a tier of the fortnight under way, with the bonus its statement gives', () => {
    const words = revealWordsOf({ kind: 'tier:2026-11-01:200000' }, P, TIERS);
    expect(words).toMatchObject({ kicker: 'Palier atteint', title: 'Palier Or', tone: 'gold' });
    expect(words?.chip).toMatch(/^Prime prévue 60/u);
    render(<>{words?.object}</>);
    expect(document.querySelector('[data-metal="or"]')).not.toBeNull();
  });

  it('promises nothing for a tier without a bonus, nor for a tier of a fortnight it has not read', () => {
    const free = [{ thresholdMinor: 100_000, bonusMinor: 0, label: 'Bronze' }];
    expect(revealWordsOf({ kind: 'tier:2026-11-01:100000' }, P, free)?.chip).toBeUndefined();
    const older = revealWordsOf({ kind: 'tier:2026-10-16:200000' }, P, TIERS);
    expect(older).toMatchObject({ title: 'Palier atteint' });
    expect(older?.chip).toBeUndefined();
  });

  it('draws nothing for a kind it does not know', () => {
    expect(revealWordsOf({ kind: 'creator_streak_7' }, P, TIERS)).toBeNull();
    expect(tierOfKind('tier:2026-11-01:100000')).toEqual({ period: '2026-11-01', thresholdMinor: 100_000 });
    expect(tierOfKind('tier:nope')).toBeNull();
  });
});
