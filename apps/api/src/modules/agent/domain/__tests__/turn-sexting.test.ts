import { describe, expect, it } from 'vitest';

import { desireMapOf } from '../fantasy-match';
import { maySuggestCustom } from '../policy';
import type { PlatformScriptView, ScriptRun } from '../script-run';
import type { TurnReading } from '../turn-briefs';
import type { OfferInput, ScriptsInput } from '../turn-scripts';
import { runFactsOf, sextingMomentOf, type RunFacts } from '../turn-sexting';

const NOW = new Date('2026-11-20T21:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const SITUATION = {
  now: NOW,
  timeZone: 'Europe/Paris',
  relationshipStartedAt: minutesAgo(6_000),
  spentCents: 1_500,
};

const HOT: TurnReading = {
  intent: 'sexting',
  sentiment: 'aroused',
  factsProposed: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Continuer.',
  toneHints: [],
  desireSignals: ['states_desire'],
};

// Her invented script, the paid step bought.
const SCRIPT: PlatformScriptView = {
  scriptRef: 'script-a',
  moment: null,
  description: 'Lingerie rouge',
  steps: [
    { stepRef: 'a-0', kind: 'free', priceMinor: null, mediaRefs: ['m-0'], mediaSheet: 'En lingerie rouge' },
    { stepRef: 'a-1', kind: 'paid', priceMinor: 1_500, mediaRefs: ['m-1'], mediaSheet: 'Le haut enlevé' },
  ],
  mediaValidated: true,
  descriptionValidated: true,
  touchesLimits: false,
};
const BOUGHT: ScriptRun = {
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
    {
      stepIndex: 1,
      kind: 'paid',
      outcome: 'bought',
      priceMinor: 1_500,
      sentAt: minutesAgo(20),
      at: minutesAgo(15),
    },
  ],
  ignoredMessages: 0,
  startedAt: minutesAgo(40),
  endedAt: null,
};
const SCRIPTS: ScriptsInput = {
  conversationRef: 'thread-demo',
  catalogue: [SCRIPT],
  history: { scripts: [{ scriptRef: 'script-a', sentStepIndexes: [0, 1], boughtStepIndexes: [1] }] },
  latest: BOUGHT,
  countsHisMessage: true,
};
const OFFER: OfferInput = {
  now: NOW,
  lastOfferAt: minutesAgo(40),
  hasNoBudget: false,
  flags: { ageConfirmedAt: '2026-11-01T10:00:00.000Z' },
  limits: { cooldownHours: 24, minDesire: 60 },
};
const HISTORY = [
  { from: 'creator' as const, text: 'Regarde', at: minutesAgo(28) },
  { from: 'creator' as const, text: 'Tu aimes ?', at: minutesAgo(14) },
  { from: 'fan' as const, text: 'Oui, la lingerie rouge', at: minutesAgo(1) },
];

const runOf = (brief: TurnReading): RunFacts =>
  runFactsOf({
    brief,
    scripts: SCRIPTS,
    offer: OFFER,
    situation: SITUATION,
    heat: 90,
    care: false,
    standingFacts: { now: NOW, knownHours: 100, spentCents: 1_500, unenteredScripts: 0 },
    standingLimits: undefined,
    history: HISTORY,
  });

describe('the sexting at a turn', () => {
  it('reads his run before her scripts decide: he came, his messages since he bought', () => {
    const run = runOf(HOT);
    expect(run).toMatchObject({ heCame: false, tease: null, warm: false, hisMessagesSinceBought: 1 });
    expect(runOf({ ...HOT, desireSignals: ['just_came'] }).heCame).toBe(true);
  });

  it('plays on his fantasy the running script meets, and asks whether he liked what he bought', () => {
    const moment = sextingMomentOf({
      brief: HOT,
      fanText: 'Oui, la lingerie rouge',
      history: HISTORY,
      situation: SITUATION,
      scriptsIn: SCRIPTS,
      scripts: undefined,
      run: runOf(HOT),
      heat: 90,
      care: false,
      trapped: false,
      ageConfirmed: true,
      noExplicit: false,
      sexualization: { kind: 'free' },
      boughtOut: false,
      hasScriptStep: false,
      customOrder: false,
      customAllowed: true,
      desireMap: desireMapOf('desires : lingerie rouge'),
      uncovered: [],
      degradingWords: [],
    });
    expect(moment.running?.scriptRef).toBe('script-a');
    expect(moment.playOn.length).toBeGreaterThan(0);
    expect(moment.currentStepSheet).toBe('Le haut enlevé');
    expect(moment.justBought).toBe(true);
    expect(moment.sexualTurn).toBe(true);
    expect(moment.boughtMediaSheet).toBe('Le haut enlevé');
  });

  it('keeps her register and his fantasy out of care', () => {
    const moment = sextingMomentOf({
      brief: HOT,
      fanText: 'Oui',
      history: HISTORY,
      situation: SITUATION,
      scriptsIn: SCRIPTS,
      scripts: undefined,
      run: runOf(HOT),
      heat: 90,
      care: true,
      trapped: false,
      ageConfirmed: true,
      noExplicit: false,
      sexualization: { kind: 'free' },
      boughtOut: false,
      hasScriptStep: false,
      customOrder: false,
      customAllowed: true,
      desireMap: desireMapOf('desires : lingerie rouge'),
      uncovered: ['pirates'],
      degradingWords: [],
    });
    expect(moment.register).toBeNull();
    expect(moment.playOn).toEqual([]);
    expect(moment.noScript).toEqual([]);
    expect(moment.inPlay).toBe(false);
  });

  it('suggests nothing made for him when he says he has no money now', () => {
    const asks: TurnReading = { ...HOT, intent: 'asks_for_media' };
    const momentOf = (brief: TurnReading) =>
      sextingMomentOf({
        brief,
        fanText: 'Tu as une vidéo de pirates ?',
        history: HISTORY,
        situation: SITUATION,
        scriptsIn: SCRIPTS,
        scripts: undefined,
        run: runOf(brief),
        heat: 90,
        care: false,
        trapped: false,
        ageConfirmed: true,
        noExplicit: false,
        sexualization: { kind: 'free' },
        boughtOut: false,
        hasScriptStep: false,
        customOrder: false,
        customAllowed: true,
        desireMap: desireMapOf('desires : pirates'),
        uncovered: ['pirates'],
        degradingWords: [],
      });
    expect(momentOf(asks).suggestsCustom).toBe(true);
    expect(momentOf({ ...asks, risks: ['no_budget'] }).suggestsCustom).toBe(false);
  });

  describe('mid-script, once he bought a step (Charles 27/11)', () => {
    // Her run, the first paid step only offered: nothing bought yet.
    const UNPAID: ScriptRun = {
      ...BOUGHT,
      steps: [
        {
          stepIndex: 0,
          kind: 'free',
          outcome: 'opened',
          priceMinor: null,
          sentAt: minutesAgo(30),
          at: minutesAgo(29),
        },
        {
          stepIndex: 1,
          kind: 'paid',
          outcome: 'sent',
          priceMinor: 1_500,
          sentAt: minutesAgo(20),
          at: minutesAgo(20),
        },
      ],
    };
    const momentOf = (
      brief: TurnReading,
      fanText: string,
      latest: ScriptRun = BOUGHT,
      customOrder = false,
      desires: readonly string[] = ['pirates'],
    ) =>
      sextingMomentOf({
        brief,
        fanText,
        history: HISTORY,
        situation: SITUATION,
        scriptsIn: { ...SCRIPTS, latest },
        scripts: undefined,
        run: runOf(brief),
        heat: 90,
        care: false,
        trapped: false,
        ageConfirmed: true,
        noExplicit: false,
        sexualization: { kind: 'free' },
        boughtOut: false,
        // Her next step goes with this answer: the script stays.
        hasScriptStep: true,
        customOrder,
        customAllowed: maySuggestCustom({ risks: brief.risks, flags: OFFER.flags }),
        desireMap: desireMapOf(`desires : ${desires.join(' · ')}`),
        uncovered: desires,
        degradingWords: [],
      });

    it('steers him to something made for him when he wants a fantasy the script does not serve', () => {
      const moment = momentOf(HOT, 'Tu peux faire la pirate pour moi ?');
      expect(moment.customMidScript).toBe(true);
      expect(moment.running?.scriptRef).toBe('script-a');
    });

    it('steers him to a cam or a video made for him when he wants one', () => {
      expect(momentOf(HOT, 'Je suis trop chaud, j’ai trop envie d’une cam').customMidScript).toBe(true);
      expect(momentOf(HOT, 'Je voudrais voir autre chose que tes vidéos').customMidScript).toBe(true);
    });

    it('suggests nothing before he bought a step of the run', () => {
      expect(momentOf(HOT, 'J’ai trop envie d’une cam', UNPAID).customMidScript).toBe(false);
      expect(momentOf(HOT, 'Tu peux faire la pirate pour moi ?', UNPAID).suggestsCustom).toBe(false);
    });

    it('suggests nothing when he says he has no money now', () => {
      expect(momentOf({ ...HOT, risks: ['no_budget'] }, 'J’ai trop envie d’une cam').customMidScript).toBe(
        false,
      );
    });

    it('leaves his own asking for a service to the custom order', () => {
      const asks: TurnReading = { ...HOT, intent: 'asks_for_service' };
      expect(momentOf(asks, 'J’ai trop envie d’une cam', BOUGHT, true).customMidScript).toBe(false);
    });

    it('reads nothing of the sexting alone, nor of a fantasy the running script meets', () => {
      expect(momentOf(HOT, 'Mmh t’es trop bonne').customMidScript).toBe(false);
      const meets = momentOf(HOT, 'La lingerie rouge me rend fou', BOUGHT, false, [
        'lingerie rouge',
        'pirates',
      ]);
      expect(meets.customMidScript).toBe(false);
    });
  });
});
