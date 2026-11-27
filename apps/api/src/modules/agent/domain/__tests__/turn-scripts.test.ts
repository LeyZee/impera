import { describe, expect, it } from 'vitest';

import { DEFAULT_GUARD_SETTINGS } from '../guards';
import type { LanguageDecision } from '../language';
import type { PlatformScriptView, ScriptRun } from '../script-run';
import type { ScriptTurn } from '../script-turn';
import type { TurnReading } from '../turn-briefs';
import {
  boughtOutNow,
  hisDesireMap,
  sameEveningAsLastOffer,
  scriptChoices,
  scriptLanguageOf,
  scriptMayAct,
  seenRun,
  stepSendsMedia,
  visibleStepSheet,
  waitingStepOf,
  type OfferInput,
  type ScriptStops,
} from '../turn-scripts';

const NOW = new Date('2026-11-20T21:00:00Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
const SITUATION = {
  now: NOW,
  timeZone: 'Europe/Paris',
  relationshipStartedAt: minutesAgo(6_000),
  spentCents: 0,
};

// Her invented catalogue.
const SCRIPT: PlatformScriptView = {
  scriptRef: 'script-a',
  moment: null,
  description: 'Lingerie rouge',
  steps: [
    { stepRef: 'a-0', kind: 'free', priceMinor: null, mediaRefs: ['m-0'], mediaSheet: 'En lingerie' },
    { stepRef: 'a-1', kind: 'paid', priceMinor: 1_500, mediaRefs: ['m-1'], mediaSheet: 'Le haut enlevé' },
  ],
  mediaValidated: true,
  descriptionValidated: true,
  touchesLimits: false,
};

const OFFER: OfferInput = {
  now: NOW,
  lastOfferAt: null,
  hasNoBudget: false,
  flags: { ageConfirmedAt: '2026-11-01T10:00:00.000Z' },
  limits: { cooldownHours: 24, minDesire: 60 },
};

const PAID_STEP: ScriptRun['steps'][number] = {
  stepIndex: 1,
  kind: 'paid',
  outcome: 'sent',
  priceMinor: 1_500,
  sentAt: minutesAgo(10),
  at: minutesAgo(10),
};
const RUN: ScriptRun = {
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

const READING: TurnReading = {
  intent: 'sexting',
  sentiment: 'aroused',
  factsProposed: [],
  risks: [],
  action: 'reply',
  replyBrief: 'Continuer le jeu.',
  toneHints: [],
};

const NOTHING: Omit<ScriptTurn, 'decision'> = {
  script: null,
  moved: null,
  followed: null,
  opened: null,
  priceMismatch: null,
};

describe('her scripts at a turn', () => {
  it('reads his language for her scripts: this message’s, his kept one, French, none when unknown', () => {
    const decision: LanguageDecision = {
      reply: 'french',
      fan: 'english',
      notSpoken: null,
      keep: null,
      humanOnly: false,
    };
    expect(scriptLanguageOf(decision, 'spanish')).toBe('spanish');
    expect(scriptLanguageOf({ ...decision, keep: 'english' }, 'spanish')).toBe('english');
    expect(scriptLanguageOf(decision, undefined)).toBe('french');
    expect(scriptLanguageOf({ ...decision, fan: 'unknown' }, 'spanish')).toBeNull();
  });

  it('gives the brain her permitted scripts by the ids it answers with', () => {
    const scripts = {
      conversationRef: 'thread-demo',
      catalogue: [SCRIPT],
      history: { scripts: [] },
      latest: null,
      countsHisMessage: true,
    };
    const ids = { max: 5, idOf: (index: number) => `s${String(index + 1)}` };
    const map = hisDesireMap('desires : lingerie rouge', DEFAULT_GUARD_SETTINGS);
    const { choices } = scriptChoices(scripts, SITUATION, map, OFFER, false, 'french', ids);
    expect(choices.map(({ id, script }) => [id, script.scriptRef])).toEqual([['s1', 'script-a']]);
    expect(scriptChoices(scripts, SITUATION, map, OFFER, true, 'french', ids).choices).toEqual([]);
    expect(scriptChoices(undefined, SITUATION, map, OFFER, false, 'french', ids)).toEqual({
      choices: [],
      uncovered: [],
    });
  });

  it('keeps her refusals out of his desire map', () => {
    const settings = { ...DEFAULT_GUARD_SETTINGS, forbiddenTerms: ['olives'] };
    expect(hisDesireMap('desires : olives · lingerie', settings).desires).toEqual(['lingerie']);
  });

  it('lists no script the same evening as her last one', () => {
    expect(sameEveningAsLastOffer(undefined, SITUATION)).toBe(false);
    expect(sameEveningAsLastOffer({ ...OFFER, lastOfferAt: minutesAgo(60) }, SITUATION)).toBe(true);
  });

  it('reads the step decided, the step waiting and what he has seen', () => {
    const send: ScriptTurn = {
      ...NOTHING,
      script: SCRIPT,
      decision: {
        kind: 'send_step',
        step: {
          scriptRef: 'script-a',
          stepIndex: 1,
          stepRef: 'a-1',
          kind: 'paid',
          priceMinor: 1_500,
          idempotencyKey: 'thread-demo:script-a:1',
        },
      },
    };
    expect(stepSendsMedia(send)).toBe(true);
    expect(stepSendsMedia(undefined)).toBe(false);
    const waiting: ScriptTurn = {
      ...NOTHING,
      decision: { kind: 'wait', step: PAID_STEP },
    };
    expect(waitingStepOf(waiting, [SCRIPT], 'script-a')).toEqual({
      price: { amountMinor: 1_500, currency: 'EUR' },
      mediaSheet: 'Le haut enlevé',
    });
    expect(
      waitingStepOf(
        { ...waiting, priceMismatch: { scriptRef: 'script-a', stepIndex: 1 } },
        [SCRIPT],
        'script-a',
      ),
    ).toBeUndefined();
    expect(visibleStepSheet(RUN, SCRIPT)).toBe('En lingerie');
    expect(seenRun(RUN, minutesAgo(20))?.steps).toHaveLength(1);
    expect(seenRun(null, NOW)).toBeNull();
  });

  it('lets her script act only when nothing stops it', () => {
    const stops: ScriptStops = {
      care: false,
      heCame: false,
      warm: false,
      teasing: false,
      herDayEnds: false,
      brief: READING,
      trapped: false,
      customOrder: false,
      objectionReply: false,
      storedPeakSeen: false,
      workPhase: undefined,
      noSale: false,
      steersBack: false,
    };
    expect(scriptMayAct(stops)).toBe(true);
    expect(scriptMayAct({ ...stops, brief: undefined })).toBe(false);
    expect(scriptMayAct({ ...stops, herDayEnds: true })).toBe(false);
    expect(scriptMayAct({ ...stops, workPhase: 'tease' })).toBe(false);
    expect(scriptMayAct({ ...stops, workPhase: 'may_start' })).toBe(true);
    expect(scriptMayAct({ ...stops, brief: { ...READING, desireSignals: ['close_to_coming'] } })).toBe(false);
    // His own asking for a cam mid-script goes to the custom order, not swallowed by the script (Charles 27/11).
    expect(scriptMayAct({ ...stops, customOrder: true })).toBe(false);
  });

  it('knows he bought her script out only when it ended this message', () => {
    expect(boughtOutNow(undefined)).toBe(false);
    expect(
      boughtOutNow({
        ...NOTHING,
        decision: { kind: 'none', reason: 'in_tension' },
        moved: {
          run: { ...RUN, status: 'bought_out' },
          events: [{ type: 'script_ended' }],
        },
      }),
    ).toBe(true);
  });
});
