import { describe, expect, it } from 'vitest';

import { maySulk, offerableScripts, offerDecision, offerSignals, type OfferContext } from '../policy';

const NOW = new Date('2026-10-17T20:00:00Z');
const hoursAgo = (hours: number): Date => new Date(NOW.getTime() - hours * 3_600_000);
const base: OfferContext = {
  now: NOW,
  lastOfferAt: null,
  desire: 80,
  fanAsksForPaid: false,
  hasNoBudget: false,
  risks: [],
  flags: { ageConfirmedAt: '2026-10-01T10:00:00Z' },
  limits: { cooldownHours: 10, minDesire: 70 },
};

describe('offerDecision', () => {
  it('reads his limits before anything, even when he asks for paid content', () => {
    const asks = { ...base, fanAsksForPaid: true };
    expect(offerDecision({ ...asks, flags: { ...base.flags, doNotContact: true } })).toEqual({
      allowed: false,
      reason: 'do_not_contact',
    });
    expect(
      offerDecision({
        ...asks,
        flags: { ...base.flags, salesFrozen: { reason: 'spending_limit', since: '2026-10-10T10:00:00Z' } },
      }),
    ).toEqual({ allowed: false, reason: 'sales_frozen' });
    expect(offerDecision({ ...asks, flags: {} })).toEqual({ allowed: false, reason: 'age_unconfirmed' });
  });

  it('allows a first script to a fan who is getting hot', () => {
    expect(offerDecision(base)).toEqual({ allowed: true });
  });

  it('never opens the sale itself: he has to be hot, at the score she set (P3-12)', () => {
    expect(offerDecision({ ...base, desire: 69 })).toEqual({ allowed: false, reason: 'low_desire' });
    expect(offerDecision({ ...base, desire: 70 })).toEqual({ allowed: true });
    expect(offerDecision({ ...base, desire: 60, limits: { ...base.limits, minDesire: 55 } })).toEqual({
      allowed: true,
    });
  });

  it('waits ten hours between two scripts, then tries again if he sexualizes again', () => {
    expect(offerDecision({ ...base, lastOfferAt: hoursAgo(9.5) })).toEqual({
      allowed: false,
      reason: 'cooldown',
    });
    expect(offerDecision({ ...base, lastOfferAt: hoursAgo(10) })).toEqual({ allowed: true });
    expect(offerDecision({ ...base, lastOfferAt: hoursAgo(12), desire: 30 })).toEqual({
      allowed: false,
      reason: 'low_desire',
    });
  });

  it('reads the cooldown the creator set', () => {
    expect(
      offerDecision({ ...base, lastOfferAt: hoursAgo(6), limits: { ...base.limits, cooldownHours: 5 } }),
    ).toEqual({
      allowed: true,
    });
  });

  it('never sells to a fan who said he has no money, or in a risk', () => {
    expect(offerDecision({ ...base, hasNoBudget: true })).toEqual({ allowed: false, reason: 'no_budget' });
    expect(offerDecision({ ...base, risks: ['money_trouble'] })).toEqual({ allowed: false, reason: 'risk' });
    expect(offerDecision({ ...base, risks: ['real_abuse'] })).toEqual({ allowed: false, reason: 'risk' });
    expect(offerDecision({ ...base, risks: ['meet_request'] })).toEqual({ allowed: true });
  });

  it('lifts the cooldown, the no-budget stop and his score when he asks for paid content himself, never a risk', () => {
    const asks = { ...base, fanAsksForPaid: true, desire: 0 };
    expect(offerDecision({ ...asks, lastOfferAt: hoursAgo(1) })).toEqual({ allowed: true });
    expect(offerDecision({ ...asks, hasNoBudget: true })).toEqual({ allowed: true });
    expect(offerDecision({ ...asks, risks: ['money_trouble'] })).toEqual({ allowed: false, reason: 'risk' });
  });
});

describe('offerDecision, whatever the rest (P3-12)', () => {
  // Every combination of what may vary: no case is left to chance.
  const cases = [false, true].flatMap((asks) =>
    [0, 39, 69, 70, 100].flatMap((desire) =>
      [false, true].flatMap((noBudget) =>
        [null, hoursAgo(1), hoursAgo(20)].flatMap((lastOfferAt) =>
          [[], ['money_trouble'], ['minor_suspected'], ['meet_request']].flatMap((risks) =>
            [true, false].map((adult): OfferContext => ({
              ...base,
              fanAsksForPaid: asks,
              desire,
              hasNoBudget: noBudget,
              lastOfferAt,
              risks,
              flags: adult ? base.flags : {},
            })),
          ),
        ),
      ),
    ),
  );

  it('never offers without a confirmed age or on a risk', () => {
    for (const context of cases) {
      const risky = context.risks.some((risk) => risk !== 'meet_request');
      if (context.flags.ageConfirmedAt === undefined || risky)
        expect(offerDecision(context).allowed, JSON.stringify(context)).toBe(false);
    }
  });

  it('offers with no budget, during the cooldown or below her score only when he asks himself', () => {
    for (const context of cases) {
      const cooling =
        context.lastOfferAt !== null && NOW.getTime() - context.lastOfferAt.getTime() < 10 * 3_600_000;
      if ((context.hasNoBudget || cooling || context.desire < 70) && offerDecision(context).allowed)
        expect(context.fanAsksForPaid, JSON.stringify(context)).toBe(true);
    }
  });
});

describe('offerDecision on a fan frozen for money', () => {
  const frozen = {
    ...base,
    flags: {
      ...base.flags,
      salesFrozen: { reason: 'money_trouble' as const, since: '2026-10-16T10:00:00Z' },
    },
  };

  it('remembers he said he cannot pay, on every later message', () => {
    expect(offerDecision(frozen)).toEqual({ allowed: false, reason: 'no_budget' });
  });

  it('lifts it only when he comes back to paid content himself, his other limits still first', () => {
    expect(offerDecision({ ...frozen, fanAsksForPaid: true })).toEqual({ allowed: true });
    expect(offerDecision({ ...frozen, fanAsksForPaid: true, risks: ['money_trouble'] })).toEqual({
      allowed: false,
      reason: 'risk',
    });
  });
});

describe('offerable scripts', () => {
  it('never offers again a script he refused, even days later', () => {
    const scripts = [{ id: 'douche' }, { id: 'lingerie' }, { id: 'reveil' }];
    expect(offerableScripts(scripts, new Set(['lingerie'])).map((s) => s.id)).toEqual(['douche', 'reveil']);
    expect(offerableScripts(scripts, new Set())).toHaveLength(3);
  });
});

describe('maySulk', () => {
  it('never sulks with sales frozen, a fragile fan or one not to write to', () => {
    expect(maySulk({})).toBe(true);
    expect(maySulk({ fragile: true })).toBe(false);
    expect(maySulk({ doNotContact: true })).toBe(false);
    expect(maySulk({ salesFrozen: { reason: 'distress', since: '2026-10-10T10:00:00Z' } })).toBe(false);
  });
});

describe('offerSignals', () => {
  it('reads his heat from the brain, and his own ask for paid content', () => {
    expect(offerSignals({ intent: 'sexting', sentiment: 'neutral' })).toEqual({
      fanSexualizes: true,
      fanAsksForPaid: false,
    });
    expect(offerSignals({ intent: 'small_talk', sentiment: 'aroused' }).fanSexualizes).toBe(true);
    expect(offerSignals({ intent: 'asks_for_media', sentiment: 'neutral' })).toEqual({
      fanSexualizes: false,
      fanAsksForPaid: true,
    });
    expect(offerSignals({ intent: 'small_talk', sentiment: 'positive' })).toEqual({
      fanSexualizes: false,
      fanAsksForPaid: false,
    });
  });
});
