import { describe, expect, it } from 'vitest';

import {
  asksMoreSameEvening,
  keepsWarm,
  sameEvening,
  maySulk,
  offerableScripts,
  offerDecision,
  offerSignals,
  type OfferContext,
} from '../policy';

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

  it('lifts the no-budget stop and his score when he asks for paid content himself, never a risk nor the evening', () => {
    const asks = { ...base, fanAsksForPaid: true, desire: 0 };
    expect(offerDecision({ ...asks, lastOfferAt: hoursAgo(11) })).toEqual({ allowed: true });
    expect(offerDecision({ ...asks, lastOfferAt: hoursAgo(7) })).toEqual({
      allowed: false,
      reason: 'cooldown',
    });
    expect(offerDecision({ ...asks, hasNoBudget: true })).toEqual({ allowed: true });
    expect(offerDecision({ ...asks, risks: ['money_trouble'] })).toEqual({ allowed: false, reason: 'risk' });
  });

  it('never two scripts the same evening, even when he asks again (ADR 0158 § 42, eval passe-18)', () => {
    // A big spender bought a whole script an hour and a half ago and asks for more: nothing new opens tonight.
    const asks = { ...base, fanAsksForPaid: true, desire: 85 };
    expect(offerDecision({ ...asks, lastOfferAt: hoursAgo(1.5) })).toEqual({
      allowed: false,
      reason: 'cooldown',
    });
    expect(offerDecision({ ...asks, lastOfferAt: hoursAgo(5.9) })).toEqual({
      allowed: false,
      reason: 'cooldown',
    });
    // Not 6 h any more (guide 26/11): her cooldown at least, and never before her next day.
    expect(offerDecision({ ...asks, lastOfferAt: hoursAgo(9) })).toEqual({
      allowed: false,
      reason: 'cooldown',
    });
    expect(offerDecision({ ...asks, lastOfferAt: hoursAgo(11) })).toEqual({ allowed: true });
  });

  it('sells nothing to a fan « à sec » until his pay, and lifts it when he asks himself (eval passe-11a)', () => {
    // The brain reads `no_budget`, not `money_trouble`: no sale, and nothing frozen on him (`protectionFor`).
    expect(offerDecision({ ...base, risks: ['no_budget'] })).toEqual({ allowed: false, reason: 'no_budget' });
    expect(offerDecision({ ...base, risks: ['no_budget'], fanAsksForPaid: true })).toEqual({ allowed: true });
  });

  it('never sells to a fan who insults her, even when he asks (ADR 0158 § 18 and § 25)', () => {
    expect(offerDecision({ ...base, risks: ['insult'], fanAsksForPaid: true })).toEqual({
      allowed: false,
      reason: 'risk',
    });
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
  it('reads his sexual advance from the brain, and his own ask for paid content', () => {
    expect(offerSignals({ intent: 'sexting', sentiment: 'neutral' })).toEqual({
      fanSexualizes: true,
      fanAsksForPaid: false,
    });
    expect(
      offerSignals({ intent: 'small_talk', sentiment: 'positive', desireSignals: ['explicit_language'] })
        .fanSexualizes,
    ).toBe(true);
    expect(offerSignals({ intent: 'asks_for_media', sentiment: 'neutral' })).toEqual({
      fanSexualizes: false,
      fanAsksForPaid: true,
    });
    expect(offerSignals({ intent: 'small_talk', sentiment: 'positive' })).toEqual({
      fanSexualizes: false,
      fanAsksForPaid: false,
    });
  });

  it('never reads a compliment, his mood alone or a question on her outfit as an advance (Charles, 16/11)', () => {
    expect(offerSignals({ intent: 'flirt', sentiment: 'positive' }).fanSexualizes).toBe(false);
    expect(offerSignals({ intent: 'flirt', sentiment: 'aroused' }).fanSexualizes).toBe(false);
    expect(
      offerSignals({ intent: 'flirt', sentiment: 'positive', desireSignals: ['body_compliment'] })
        .fanSexualizes,
    ).toBe(false);
    expect(
      offerSignals({ intent: 'flirt', sentiment: 'positive', desireSignals: ['asks_about_her_body'] })
        .fanSexualizes,
    ).toBe(false);
    expect(
      offerSignals({ intent: 'sexting', sentiment: 'aroused', desireSignals: ['states_desire'] })
        .fanSexualizes,
    ).toBe(true);
  });

  it('reads a desire on a flirt only when his own words carry it (Charles, 20/11; relecture Bilan de #888)', () => {
    const flirt = (signal: string, text?: string) =>
      offerSignals(
        { intent: 'flirt', sentiment: 'aroused', desireSignals: ['body_compliment', signal] },
        text,
      ).fanSexualizes;
    for (const signal of ['states_desire', 'steers_to_intimate']) {
      expect(flirt(signal), signal).toBe(false);
      expect(flirt(signal, 'coucou toi, tu es super belle ! impossible de ne pas t’écrire'), signal).toBe(
        false,
      );
      expect(flirt(signal, 'j’ai envie de te parler, t’as un sourire de fou'), signal).toBe(false);
      expect(flirt(signal, 't’es trop belle, j’ai trop envie de toi là'), signal).toBe(true);
      expect(flirt(signal, 'Tu m’EXCITES grave'), signal).toBe(true);
    }
    for (const signal of ['explicit_language', 'roleplay']) expect(flirt(signal), signal).toBe(true);
    expect(
      offerSignals({ intent: 'small_talk', sentiment: 'positive', desireSignals: ['states_desire'] })
        .fanSexualizes,
    ).toBe(true);
  });
});

describe('the same evening (passe 18, guide 26/11): at least her cooldown, never before her next day', () => {
  const limits = { cooldownHours: 10, minDesire: 0 };
  const now = new Date('2026-10-17T21:00:00Z'); // 23:00 in Paris
  const at = (hours: number) => new Date(now.getTime() - hours * 3_600_000);
  it('counts only his own asking within the same evening', () => {
    const ask = (lastOfferAt: Date | null, fanAsksForPaid: boolean) =>
      asksMoreSameEvening({ now, lastOfferAt, fanAsksForPaid, limits, timeZone: 'Europe/Paris' });
    expect(ask(at(1), true)).toBe(true);
    expect(ask(at(1), false)).toBe(false);
    expect(ask(at(7), true)).toBe(true);
    expect(ask(null, true)).toBe(false);
  });

  it('lasts her cooldown, and past it still until her next day', () => {
    expect(sameEvening(now, at(9), 10, undefined)).toBe(true);
    expect(sameEvening(now, at(11), 10, undefined)).toBe(false);
    // 11 h ago in Paris was 12:00 the same day: still the same day there.
    expect(sameEvening(now, at(11), 10, 'Europe/Paris')).toBe(true);
    expect(sameEvening(now, at(24), 10, 'Europe/Paris')).toBe(false);
  });
});

describe('a broke fan kept warm (passe 11a, Charles 21/11)', () => {
  it('keeps warm only a fan who already paid and is broke for now, never a fan in real trouble', () => {
    expect(keepsWarm({ risks: ['no_budget'], hasBought: true })).toBe(true);
    expect(keepsWarm({ risks: ['no_budget'], hasBought: false })).toBe(false);
    expect(keepsWarm({ risks: [], hasBought: true })).toBe(false);
    expect(keepsWarm({ risks: ['no_budget', 'money_trouble'], hasBought: true })).toBe(false);
    expect(keepsWarm({ risks: ['no_budget', 'distress'], hasBought: true })).toBe(false);
  });
});
