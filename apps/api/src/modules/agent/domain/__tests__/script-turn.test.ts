import { describe, expect, it } from 'vitest';

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
    { kind: 'free', priceMinor: null },
    { kind: 'paid', priceMinor: 1_500 },
    { kind: 'paid', priceMinor: 2_500 },
  ],
  mediaValidated: true,
  touchesLimits: false,
};

const history = (sent: number[], bought: number[] = []): ScriptHistoryView => ({
  scripts: [{ scriptRef: NIGHT.scriptRef, sentStepIndexes: sent, boughtStepIndexes: bought }],
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

const input: ScriptTurnInput = {
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

describe('one message of his, for scripts (ADR 0098 § 4)', () => {
  it('opens the script the brain picked with its teasing, journaled', () => {
    const turn = scriptTurn(input);

    expect(turn.decision.kind).toBe('start');
    expect(turn.script?.scriptRef).toBe(NIGHT.scriptRef);
    expect(turn.opened?.run.steps.map((step) => [step.stepIndex, step.outcome])).toEqual([[0, 'sent']]);
    expect(turn.opened?.events).toEqual([
      { type: 'script_started' },
      { type: 'script_step_sent', stepIndex: 0 },
    ]);
    expect(turn.moved).toBeNull();
  });

  it('sells nothing and moves nothing when Reveal’s history cannot be read', () => {
    const turn = scriptTurn({ ...input, latest: offered, history: null, reply: 'refused' });

    expect(turn.decision).toEqual({ kind: 'none', reason: 'no_history' });
    expect(turn.moved).toBeNull();
    expect(turn.opened).toBeNull();
  });

  it('climbs to the paid step in the same session, at the catalogue’s price', () => {
    const turn = scriptTurn({ ...input, latest: teased, history: history([0]) });

    expect(turn.decision).toMatchObject({ kind: 'send_step', step: { stepIndex: 1, priceMinor: 1_500 } });
    expect(turn.moved?.events).toEqual([{ type: 'script_step_sent', stepIndex: 1 }]);
    // Without a draft, nothing was sent: the run stays as Reveal and his message left it.
    expect(turn.followed).toBeNull();
  });

  it('ends the run on a clear no to the paid step, said once', () => {
    const turn = scriptTurn({ ...input, latest: offered, history: history([0, 1]), reply: 'refused' });

    expect(turn.decision.kind).toBe('after_refusal');
    expect(turn.moved?.run.status).toBe('refused');
    expect(turn.moved?.events).toEqual([
      { type: 'script_step_refused', stepIndex: 1 },
      { type: 'script_ended' },
    ]);
    expect(turn.followed).toEqual(turn.moved);
  });

  it('counts two messages that ignore the paid step as a refusal', () => {
    const first = scriptTurn({ ...input, latest: offered, history: history([0, 1]) });
    expect(first.decision.kind).toBe('wait');
    expect(first.moved?.run.ignoredMessages).toBe(1);
    expect(first.moved?.events).toEqual([]);

    const second = scriptTurn({ ...input, latest: first.moved?.run ?? null, history: history([0, 1]) });
    expect(second.decision.kind).toBe('after_refusal');
    expect(second.moved?.run.status).toBe('refused');
  });

  it('pauses while he is not free: his messages neither refuse nor ignore the step (ADR 0103 § 12)', () => {
    const first = scriptTurn({ ...input, latest: offered, history: history([0, 1]), availability: 'no' });
    expect(first.decision.kind).toBe('wait');
    expect(first.moved).toBeNull();
    const refused = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1]),
      reply: 'refused',
      availability: 'no',
    });
    expect(refused.decision.kind).toBe('wait');
    expect(refused.moved).toBeNull();
  });

  it('never takes his « je l’ai pris » for a purchase: only Reveal says what he bought', () => {
    const claimed = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1]),
      reply: 'claims_bought',
    });
    expect(claimed.decision.kind).toBe('wait');
    expect(claimed.moved).toBeNull();

    const bought = scriptTurn({ ...input, latest: offered, history: history([0, 1], [1]) });
    expect(bought.decision).toMatchObject({ kind: 'send_step', step: { stepIndex: 2, priceMinor: 2_500 } });
    expect(bought.moved?.run.steps.map((step) => step.outcome)).toEqual(['sent', 'bought', 'sent']);
  });

  it('ends the run once Reveal says the last step is bought', () => {
    const all = played([
      { type: 'step_sent', stepIndex: 0, at: BEFORE },
      { type: 'step_sent', stepIndex: 1, at: BEFORE },
      { type: 'step_bought', stepIndex: 1, at: BEFORE },
      { type: 'step_sent', stepIndex: 2, at: BEFORE },
    ]);
    const turn = scriptTurn({ ...input, latest: all, history: history([0, 1, 2], [1, 2]) });

    expect(turn.decision).toEqual({ kind: 'end', status: 'bought_out' });
    expect(turn.moved?.events).toEqual([{ type: 'script_ended' }]);
  });

  it('lets no step go when something else answers him, and does not count a message twice', () => {
    const held = scriptTurn({ ...input, mayAct: false });
    expect(held.decision).toEqual({ kind: 'none', reason: 'held' });
    expect(held.opened).toBeNull();

    const again = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1]),
      countsHisMessage: false,
    });
    expect(again.moved).toBeNull();
  });

  it('alerts when the step waiting no longer has the price she said', () => {
    const repriced: PlatformScriptView = {
      ...NIGHT,
      steps: NIGHT.steps.map((step, index) => (index === 1 ? { ...step, priceMinor: 1_900 } : step)),
    };
    const turn = scriptTurn({
      ...input,
      catalogue: [repriced],
      latest: offered,
      history: history([0, 1]),
      reply: 'answers_step',
    });

    expect(turn.decision.kind).toBe('wait');
    expect(turn.priceMismatch).toEqual({ scriptRef: NIGHT.scriptRef, stepIndex: 1 });
  });

  it('leaves an open run whose script left her catalogue as it is, and sends nothing', () => {
    const turn = scriptTurn({ ...input, catalogue: [], latest: teased, history: history([0]) });

    expect(turn.decision).toEqual({ kind: 'none', reason: 'no_script' });
    expect(turn.moved).toBeNull();
  });
});
