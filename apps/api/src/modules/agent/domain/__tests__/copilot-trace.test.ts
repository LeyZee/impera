import { CopilotTraceSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { copilotTrace, type CopilotTraceInput } from '../copilot-trace';
import type { OfferContext } from '../policy';
import {
  applyScriptRunEvent,
  openScriptRun,
  type PlatformScriptView,
  type ScriptHistoryView,
  type ScriptRun,
  type ScriptRunEvent,
} from '../script-run';
import { scriptTurn, type ScriptTurnInput } from '../script-turn';

const NOW = new Date('2026-11-12T21:00:00Z');
const BEFORE = new Date('2026-11-12T20:40:00Z');

/** A made-up script (ADR 0010): teasing (0), two paid steps (1, 2). */
const NIGHT: PlatformScriptView = {
  scriptRef: 'script-night',
  moment: 'night',
  description: 'Soirée de démonstration',
  steps: [
    { stepRef: 'step-ref', kind: 'free', priceMinor: null, mediaRefs: [] },
    { stepRef: 'step-ref', kind: 'paid', priceMinor: 1_500, mediaRefs: [] },
    { stepRef: 'step-ref', kind: 'paid', priceMinor: 2_500, mediaRefs: [] },
  ],
  mediaValidated: true,
  descriptionValidated: true,
  touchesLimits: false,
};

const history = (sent: number[]): ScriptHistoryView => ({
  scripts: [{ scriptRef: NIGHT.scriptRef, sentStepIndexes: sent, boughtStepIndexes: [] }],
});

const offer: OfferContext = {
  now: NOW,
  lastOfferAt: null,
  desire: 80,
  fanAsksForPaid: false,
  hasNoBudget: false,
  risks: [],
  flags: { ageConfirmedAt: '2026-10-01T10:00:00Z' },
  limits: { cooldownHours: 10, minDesire: 70 },
};

const turnInput: ScriptTurnInput = {
  now: NOW,
  conversationRef: 'conv-demo',
  latest: null,
  catalogue: [NIGHT],
  history: { scripts: [] },
  moment: 'night',
  hotSession: true,
  brainPick: NIGHT.scriptRef,
  offer,
  careMode: false,
  reply: null,
  countsHisMessage: true,
  mayAct: true,
};

function played(events: readonly ScriptRunEvent[]): ScriptRun {
  let run = openScriptRun(NIGHT.scriptRef, BEFORE);
  for (const event of events) {
    const result = applyScriptRunEvent(run, NIGHT, event);
    if (!result.ok) throw new Error(result.fault);
    run = result.run;
  }
  return run;
}

const teased = played([{ type: 'step_sent', stepIndex: 0, at: BEFORE }]);
const offered = played([
  { type: 'step_sent', stepIndex: 0, at: BEFORE },
  { type: 'step_sent', stepIndex: 1, at: BEFORE },
]);

const plain: CopilotTraceInput = {
  objectionAnswered: false,
  catalogue: [NIGHT],
  latest: null,
  care: false,
  rewritten: false,
};

describe('what the code decided with a draft, for the copilot (ADR 0141 lot a)', () => {
  it('says to offer the paid step decided, at its price, with where the script stands', () => {
    const scripts = scriptTurn({ ...turnInput, latest: teased, history: history([0]) });
    const trace = copilotTrace({ ...plain, scripts, latest: teased });

    expect(trace.move).toEqual({ kind: 'offer_step', priceMinor: 1_500, block: null });
    expect(trace.sale).toEqual({
      scriptRef: NIGHT.scriptRef,
      scriptName: 'Soirée de démonstration',
      stepIndex: 1,
      stepCount: 3,
      nextStep: { stepIndex: 1, priceMinor: 1_500 },
      refusedStepIndexes: [],
      offerPending: true,
    });
    expect(trace.saleMoment).toEqual({ verdict: 'good', conditions: [] });
    // What is kept with the draft reads back through the contract: codes and numbers only.
    expect(CopilotTraceSchema.parse(trace)).toEqual(trace);
  });

  it('after his no, shows the step he refused and offers nothing more of that script', () => {
    const scripts = scriptTurn({ ...turnInput, latest: offered, history: history([0, 1]), reply: 'refused' });
    const trace = copilotTrace({ ...plain, scripts, latest: offered });

    expect(trace.move.kind).not.toBe('offer_step');
    expect(trace.sale?.refusedStepIndexes).toEqual([1]);
    expect(trace.sale?.nextStep).toBeNull();
    expect(trace.sale?.offerPending).toBe(false);
  });

  it('waits on the step sent, and says it is what the moment waits for', () => {
    const scripts = scriptTurn({ ...turnInput, latest: offered, history: history([0, 1]) });
    const trace = copilotTrace({ ...plain, scripts, latest: offered });

    expect(scripts.decision.kind).toBe('wait');
    expect(trace.move.kind).toBe('wait');
    expect(trace.saleMoment).toEqual({ verdict: 'soon', conditions: [{ code: 'step_waiting', met: false }] });
  });

  it('says why nothing is sold, with the block of the policy, and the conditions missing', () => {
    const trace = copilotTrace({
      ...plain,
      offerRefused: 'cooldown',
      scriptStart: { open: false, missing: ['desire_below_threshold', 'availability_unconfirmed'] },
    });

    expect(trace.move).toEqual({ kind: 'no_sale', priceMinor: null, block: 'cooldown' });
    expect(trace.saleMoment?.verdict).toBe('not_yet');
    expect(trace.saleMoment?.conditions.map((condition) => condition.code)).toEqual([
      'desire_below_threshold',
      'availability_unconfirmed',
      'cooldown',
    ]);
  });

  it('gives no moment to sell under a block that forbids any sale', () => {
    const trace = copilotTrace({ ...plain, offerRefused: 'risk', scriptStart: { open: true } });

    expect(trace.move).toEqual({ kind: 'no_sale', priceMinor: null, block: 'risk' });
    expect(trace.saleMoment).toBeNull();
  });

  it('in the care mode: a plain answer, no sale and no moment, and says why', () => {
    const scripts = scriptTurn({ ...turnInput, latest: teased, history: history([0]) });
    const trace = copilotTrace({ ...plain, scripts, latest: teased, care: true });

    expect(trace.move.kind).toBe('reply');
    expect(trace.sale).toBeNull();
    expect(trace.saleMoment).toBeNull();
    expect(trace.reasons).toEqual(['care']);
  });

  it('names the custom order and the objection gestures, and a rewrite', () => {
    expect(copilotTrace({ ...plain, customOrder: 'decline' }).move.kind).toBe('custom_order_decline');
    expect(copilotTrace({ ...plain, customOrder: 'wait' }).move.kind).toBe('custom_order_wait');
    expect(copilotTrace({ ...plain, objectionAnswered: true }).move.kind).toBe('answer_objection');
    expect(copilotTrace({ ...plain, rewritten: true }).reasons).toEqual(['rewritten_once']);
  });

  it('gives the direction of his desire, never its figure', () => {
    const reading = (before: number | null, score: number) => ({
      before,
      score,
      signals: [],
      weightsVersion: 'test',
    });
    expect(copilotTrace({ ...plain, desireRead: reading(40, 55) }).desireTrend).toBe('up');
    expect(copilotTrace({ ...plain, desireRead: reading(55, 40) }).desireTrend).toBe('down');
    expect(copilotTrace({ ...plain, desireRead: reading(40, 40) }).desireTrend).toBe('flat');
    expect(copilotTrace({ ...plain, desireRead: reading(null, 40) }).desireTrend).toBeNull();
  });

  it('names a long script by the start of its description, cut on a word', () => {
    const long = {
      ...NIGHT,
      description:
        'Une soirée de démonstration assez longue pour dépasser la limite du panneau sans aucun doute',
    };
    const scripts = scriptTurn({ ...turnInput, catalogue: [long], latest: teased, history: history([0]) });
    const name =
      copilotTrace({ ...plain, catalogue: [long], scripts, latest: teased }).sale?.scriptName ?? '';

    expect(name.endsWith('…')).toBe(true);
    expect(name.length).toBeLessThanOrEqual(61);
  });
});

describe('the staircase in the trace (ADR 0098, avenant du 27/11/2026)', () => {
  it('keeps the paid step decided, its price and why', () => {
    const scripts = scriptTurn({ ...turnInput, latest: teased, history: history([0]) });
    const trace = copilotTrace({ ...plain, scripts, latest: teased });
    expect(trace.stepPrice).toEqual({
      stepIndex: 1,
      priceMinor: 1_500,
      reason: 'next_step',
      previousPaidMinor: null,
      capMinor: null,
    });
    expect(CopilotTraceSchema.parse(trace)).toEqual(trace);
  });

  it('says the cap of his biggest purchase when the first paid step is above it', () => {
    const scripts = scriptTurn({
      ...turnInput,
      latest: teased,
      history: history([0]),
      pricing: { biggestPurchaseMinor: 800 },
    });
    const trace = copilotTrace({ ...plain, scripts, latest: teased });
    expect(trace.stepPrice).toEqual({
      stepIndex: 1,
      priceMinor: null,
      reason: 'capped_by_biggest_purchase',
      previousPaidMinor: null,
      capMinor: 1_200,
    });
  });

  it('carries nothing when no paid step is decided', () => {
    expect(copilotTrace(plain).stepPrice).toBeUndefined();
  });
});
