import { describe, expect, it } from 'vitest';

import type { ScriptRun } from '../script-run';
import type { ScriptTurn } from '../script-turn';
import type { TurnReading } from '../turn-briefs';
import {
  asksMoreTonight,
  objectionReplyOf,
  offerRefusal,
  offerRefusedOf,
  saleMovesOf,
  type SaleLeads,
} from '../turn-sale';
import type { OfferInput, ScriptsInput } from '../turn-scripts';

const NOW = new Date('2026-11-20T21:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const OFFER: OfferInput = {
  now: NOW,
  lastOfferAt: null,
  hasNoBudget: false,
  flags: { ageConfirmedAt: '2026-11-01T10:00:00.000Z' },
  limits: { cooldownHours: 24, minDesire: 60 },
  timeZone: 'Europe/Paris',
};

const READ: TurnReading = {
  intent: 'sexting',
  sentiment: 'aroused',
  factsProposed: [],
  risks: [],
  action: 'offer',
  replyBrief: 'Lui proposer la suite.',
  toneHints: [],
};

const NO_LEADS: SaleLeads = {
  care: false,
  hasScriptStep: false,
  customOrder: undefined,
  objectionReply: undefined,
  trapped: false,
  steersBack: false,
};

// An invented run: an offered step opened, then a paid one at 15 € waiting.
const PAID_STEP: ScriptRun['steps'][number] = {
  stepIndex: 1,
  kind: 'paid',
  outcome: 'sent',
  priceMinor: 1_500,
  sentAt: minutesAgo(10),
  at: minutesAgo(10),
};
const WAITING: ScriptRun = {
  scriptRef: 'script-a',
  status: 'open',
  steps: [
    {
      stepIndex: 0,
      kind: 'free',
      outcome: 'opened',
      priceMinor: null,
      sentAt: minutesAgo(30),
      at: minutesAgo(29),
    },
    PAID_STEP,
  ],
  ignoredMessages: 0,
  startedAt: minutesAgo(40),
  endedAt: null,
};
const SCRIPTS_IN: ScriptsInput = {
  conversationRef: 'thread-demo',
  catalogue: [
    {
      scriptRef: 'script-a',
      moment: null,
      description: 'Démonstration',
      steps: [
        { stepRef: 'a-0', kind: 'free', priceMinor: null, mediaRefs: [] },
        {
          stepRef: 'a-1',
          kind: 'paid',
          priceMinor: 1_500,
          mediaRefs: ['m'],
          mediaSheet: 'Elle enlève le haut',
        },
      ],
      mediaValidated: true,
      descriptionValidated: true,
      touchesLimits: false,
    },
  ],
  history: { scripts: [] },
  latest: WAITING,
  countsHisMessage: true,
};
const WAIT_TURN: ScriptTurn = {
  decision: { kind: 'wait', step: PAID_STEP },
  script: null,
  moved: null,
  followed: null,
  opened: null,
  priceMismatch: null,
};

describe('the offer decided by code', () => {
  it('lets the policy refuse a brain’s offer, and says why', () => {
    expect(offerRefusal(READ, undefined, 90)).toBe('no_offer_context');
    expect(offerRefusal(READ, OFFER, 10)).toBe('low_desire');
    expect(offerRefusal(READ, OFFER, 90)).toBeUndefined();
  });

  it('refuses an offer in order: he came, her tease, her scripts, the gate, then the policy', () => {
    const base = {
      cursored: READ,
      hasScriptStep: false,
      heCame: false,
      teasing: false,
      scriptsDecide: false,
      scriptStart: undefined,
      offer: OFFER,
      heat: 90,
    };
    expect(offerRefusedOf({ ...base, cursored: { ...READ, action: 'reply' } })).toBeUndefined();
    expect(offerRefusedOf({ ...base, hasScriptStep: true, heCame: true })).toBeUndefined();
    expect(offerRefusedOf({ ...base, heCame: true, teasing: true })).toBe('he_came');
    expect(offerRefusedOf({ ...base, teasing: true, scriptsDecide: true })).toBe('abandon_tease');
    expect(offerRefusedOf({ ...base, scriptsDecide: true })).toBe('no_script_step');
    expect(
      offerRefusedOf({ ...base, scriptStart: { open: false, missing: ['availability_unconfirmed'] } }),
    ).toBe('availability_unconfirmed');
    expect(offerRefusedOf({ ...base, heat: 10 })).toBe('low_desire');
  });

  it('picks a reply of her bank for his price objection, never in care nor on a trap', () => {
    const objections = {
      bank: { too_expensive: [{ id: 'reply0001', text: 'Elle assume son prix.' }] },
      usedReplyIds: new Set<string>(),
    };
    const objection: TurnReading = { ...READ, intent: 'price_objection', objection: 'too_expensive' };
    expect(objectionReplyOf(objection, false, false, objections)).toMatchObject({
      objection: 'too_expensive',
      text: 'Elle assume son prix.',
    });
    expect(objectionReplyOf(objection, true, false, objections)).toBeUndefined();
    expect(objectionReplyOf(objection, false, true, objections)).toBeUndefined();
    expect(objectionReplyOf(READ, false, false, objections)).toBeUndefined();
  });

  describe('he asks for more the evening he bought (passe 18)', () => {
    const tonight = { ...OFFER, lastOfferAt: minutesAgo(60) };
    const asks: TurnReading = { ...READ, intent: 'asks_for_media' };
    const runOf = (outcome: 'bought' | 'sent' | 'refused', boughtMinutesAgo: number): ScriptRun => ({
      scriptRef: 'script-a',
      status: 'open',
      steps: [
        {
          stepIndex: 0,
          kind: 'paid',
          outcome,
          priceMinor: 1_500,
          sentAt: minutesAgo(boughtMinutesAgo + 5),
          at: minutesAgo(boughtMinutesAgo),
        },
      ],
      ignoredMessages: 0,
      startedAt: minutesAgo(boughtMinutesAgo + 10),
      endedAt: null,
    });
    const boughtTonight = runOf('bought', 45);

    it('steers him to a custom only when he bought a step this evening', () => {
      expect(asksMoreTonight(asks, tonight, false, boughtTonight)).toBe(true);
      expect(asksMoreTonight(asks, tonight, true, boughtTonight)).toBe(false);
      expect(asksMoreTonight(undefined, tonight, false, boughtTonight)).toBe(false);
      expect(
        asksMoreTonight({ ...READ, intent: 'small_talk', desireSignals: [] }, tonight, false, boughtTonight),
      ).toBe(false);
    });

    it('follows the normal flow when her script was only offered or refused tonight', () => {
      expect(asksMoreTonight(asks, tonight, false, runOf('sent', 45))).toBe(false);
      expect(asksMoreTonight(asks, tonight, false, runOf('refused', 45))).toBe(false);
      expect(asksMoreTonight(asks, tonight, false, null)).toBe(false);
      expect(asksMoreTonight(asks, tonight, false, undefined)).toBe(false);
    });

    it('follows the normal flow when he bought another evening', () => {
      // 30 h ago: past her 24 h cooldown and another day in Paris.
      expect(asksMoreTonight(asks, tonight, false, runOf('bought', 30 * 60))).toBe(false);
    });

    it('steers no fan with no money now to a custom or a cam', () => {
      expect(asksMoreTonight({ ...asks, risks: ['no_budget'] }, tonight, false, boughtTonight)).toBe(false);
      expect(asksMoreTonight({ ...asks, risks: ['money_trouble'] }, tonight, false, boughtTonight)).toBe(
        false,
      );
      expect(asksMoreTonight({ ...asks, risks: ['distress'] }, tonight, false, boughtTonight)).toBe(false);
      const frozen: OfferInput = {
        ...tonight,
        flags: {
          ...tonight.flags,
          salesFrozen: { reason: 'money_trouble', since: '2026-11-10T10:00:00.000Z' },
        },
      };
      expect(asksMoreTonight(asks, frozen, false, boughtTonight)).toBe(false);
    });
  });
});

describe('the moves after a sale', () => {
  const facts = {
    situation: { now: NOW, timeZone: 'Europe/Paris', relationshipStartedAt: minutesAgo(600), spentCents: 0 },
    history: [],
    scriptsIn: SCRIPTS_IN,
    offer: OFFER,
    scripts: WAIT_TURN,
    heat: 90,
    saleTrouble: undefined,
  };

  it('shows the voice the step waiting, at its price, when he asks how to pay', () => {
    const moves = saleMovesOf({ ...facts, brief: { ...READ, intent: 'payment_help' } }, NO_LEADS);
    expect(moves.waitingStep).toEqual({
      price: { amountMinor: 1_500, currency: 'EUR' },
      mediaSheet: 'Elle enlève le haut',
    });
    expect(moves.saleTrouble).toEqual({ kind: 'answer', trouble: 'payment_help' });
  });

  it('hands his trouble to a human when she already helped him a moment ago', () => {
    const moves = saleMovesOf(
      {
        ...facts,
        brief: { ...READ, intent: 'payment_help' },
        saleTrouble: { seen: { paymentHelpAt: minutesAgo(5), complaintAt: null }, hasBought: false },
      },
      NO_LEADS,
    );
    expect(moves.saleTrouble).toEqual({ kind: 'handoff', trouble: 'payment_help' });
    expect(moves.waitingStep).toBeUndefined();
  });

  it('helps nobody pay in care, nor on a trap', () => {
    const brief: TurnReading = { ...READ, intent: 'payment_help' };
    expect(saleMovesOf({ ...facts, brief }, { ...NO_LEADS, care: true }).waitingStep).toBeUndefined();
    expect(saleMovesOf({ ...facts, brief }, { ...NO_LEADS, trapped: true }).waitingStep).toBeUndefined();
  });

  it('answers a complaint about what he bought', () => {
    const moves = saleMovesOf(
      {
        ...facts,
        brief: { ...READ, intent: 'complaint', sentiment: 'negative' },
        saleTrouble: { seen: { paymentHelpAt: null, complaintAt: null }, hasBought: true },
      },
      NO_LEADS,
    );
    expect(moves.complaint).toBe(true);
    expect(moves.refusal).toBeNull();
  });

  it('asks why when her script turn reads his refusal', () => {
    const refused: ScriptTurn = { ...WAIT_TURN, decision: { kind: 'after_refusal', step: PAID_STEP } };
    expect(saleMovesOf({ ...facts, brief: READ, scripts: refused }, NO_LEADS).refusal).toBe('ask_why');
    expect(
      saleMovesOf({ ...facts, brief: READ, scripts: refused }, { ...NO_LEADS, care: true }).refusal,
    ).toBeNull();
  });
});
