import { describe, expect, it } from 'vitest';

import type { TurnReading } from '../turn-briefs';
import {
  asksAvailabilityNow,
  farewellNow,
  occasionHintsOf,
  pacedHints,
  teaseSaid,
  toneHintsOfTurn,
  type AnswerLeads,
  type TurnHintFacts,
} from '../turn-hints';
import type { SextingMoment } from '../turn-sexting';
import {
  ABANDON_HINTS,
  ASK_AVAILABILITY_HINT,
  ASKS_IF_BOT_HINT,
  FAREWELL_HINTS,
  HE_CAME_EARLY_HINT,
  HE_CAME_HINT,
  INSULT_HINT,
  KEEP_WARM_HINT,
  NO_MOANS_HINT,
  NOT_SHOWN_YET_HINT,
  PROOF_HINTS,
  REGISTER_HINTS,
  SPENDER_REGISTER_HINTS,
  TIME_WASTER_HINTS,
} from '../turn-texts';

const READ: TurnReading = {
  intent: 'small_talk',
  sentiment: 'positive',
  factsProposed: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Lui répondre.',
  toneHints: [],
};

const NO_LEADS: AnswerLeads = {
  care: false,
  hasScriptStep: false,
  customOrder: false,
  objectionReply: false,
  trapped: false,
  steersBack: false,
};

const CALM: SextingMoment = {
  heCameUnpaid: false,
  inTension: false,
  limitReached: false,
  opensItHerself: false,
  register: null,
  running: null,
  playOn: [],
  noScript: [],
  holdsBack: false,
  gauge: false,
  currentStepSheet: undefined,
  sexualTurn: false,
  projection: false,
  inAction: false,
  justBought: false,
  compliment: false,
  suggestsCustom: false,
  cameEarly: false,
  inPlay: false,
  haggling: false,
  murmur: false,
  otherManWanted: false,
  degradedByHim: false,
  boughtMediaSheet: undefined,
};

const PLAIN: TurnHintFacts = {
  fanText: 'Ça va ?',
  care: false,
  heCame: false,
  farewell: null,
  asking: false,
  paced: [],
  reminds: false,
  meeting: undefined,
  insulted: false,
  afterInsult: false,
  playsJealous: false,
  workPhase: undefined,
  noSale: false,
  backToSale: false,
  warm: false,
  moreTonight: false,
  occasionHints: [],
  sexting: CALM,
  timeWaster: undefined,
  spenderRegister: undefined,
  hasWaitingStep: false,
  complaint: false,
  refusal: null,
  teases: null,
};

describe('the hints of a turn', () => {
  it('says nothing on an ordinary answer', () => {
    expect(toneHintsOfTurn(PLAIN)).toEqual([]);
  });

  it('lets his coming, a goodbye, or her question on his availability lead alone', () => {
    expect(
      toneHintsOfTurn({
        ...PLAIN,
        heCame: true,
        sexting: { ...CALM, cameEarly: true },
        farewell: 'away',
        warm: true,
      }),
    ).toEqual([HE_CAME_HINT, HE_CAME_EARLY_HINT, FAREWELL_HINTS.away]);
    expect(toneHintsOfTurn({ ...PLAIN, farewell: 'says_goodnight', warm: true })).toEqual([
      FAREWELL_HINTS.says_goodnight,
    ]);
    expect(toneHintsOfTurn({ ...PLAIN, asking: true, insulted: true })).toEqual([ASK_AVAILABILITY_HINT]);
  });

  it('keeps every other move in its order', () => {
    expect(
      toneHintsOfTurn({
        ...PLAIN,
        paced: ['pace'],
        insulted: true,
        warm: true,
        occasionHints: ['occasion'],
        sexting: { ...CALM, register: 'sensual', running: null, sexualTurn: true },
        timeWaster: 'slowed',
        spenderRegister: 'close',
        teases: 'first',
      }),
    ).toEqual([
      'pace',
      INSULT_HINT,
      NO_MOANS_HINT,
      KEEP_WARM_HINT,
      'occasion',
      REGISTER_HINTS.sensual,
      TIME_WASTER_HINTS.slowed,
      SPENDER_REGISTER_HINTS.close,
      ABANDON_HINTS.first,
    ]);
  });

  it('says what her media did not show yet only while her script runs', () => {
    const running = {
      scriptRef: 'script-a',
      status: 'open' as const,
      steps: [],
      ignoredMessages: 0,
      startedAt: new Date('2026-11-20T20:00:00Z'),
      endedAt: null,
    };
    expect(
      toneHintsOfTurn({ ...PLAIN, sexting: { ...CALM, register: 'explicit', running, sexualTurn: true } }),
    ).toContain(NOT_SHOWN_YET_HINT);
  });

  it('drops the time-waster’s and the spender’s hints in care', () => {
    expect(
      toneHintsOfTurn({ ...PLAIN, care: true, timeWaster: 'slowed', spenderRegister: 'girlfriend' }),
    ).toEqual([]);
  });

  it('says goodbye unless a step leads, and at the end of her day', () => {
    const night: TurnReading = { ...READ, desireSignals: ['says_goodnight'] };
    expect(farewellNow(night, false, false, false)).toBe('says_goodnight');
    expect(farewellNow(night, true, false, false)).toBeNull();
    expect(farewellNow(READ, false, false, true)).toBe('her_day_ends');
    expect(farewellNow(READ, false, true, true)).toBeNull();
  });

  it('teases him only where nothing else leads', () => {
    expect(teaseSaid('again', null, false, false, false)).toBe('again');
    expect(teaseSaid('again', 'away', false, false, false)).toBeNull();
    expect(teaseSaid('again', null, true, false, false)).toBeNull();
    expect(teaseSaid('again', null, false, false, true)).toBeNull();
  });

  it('answers the moments code knows, by where he stands', () => {
    const facts = {
      care: false,
      customOrder: false,
      standing: 'new' as const,
      ageConfirmed: true,
      noExplicit: false,
    };
    expect(occasionHintsOf({ ...READ, intent: 'asks_if_bot' }, facts)).toEqual([ASKS_IF_BOT_HINT]);
    expect(occasionHintsOf({ ...READ, occasion: 'asks_proof' }, facts)).toEqual([PROOF_HINTS.relay]);
    expect(occasionHintsOf({ ...READ, occasion: 'asks_proof' }, { ...facts, customOrder: true })).toEqual([]);
    expect(occasionHintsOf({ ...READ, intent: 'asks_if_bot' }, { ...facts, care: true })).toEqual([]);
  });

  it('asks his availability and paces her questions only when nothing else leads', () => {
    expect(asksAvailabilityNow(undefined, undefined, NO_LEADS)).toBe(false);
    expect(pacedHints({ action: 'offer' }, false, 'Salut', [], NO_LEADS)).toEqual([]);
    expect(pacedHints({ action: 'reply' }, false, 'Salut', [], { ...NO_LEADS, trapped: true })).toEqual([]);
  });
});
