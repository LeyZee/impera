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
    { stepRef: 'step-ref', kind: 'free', priceMinor: null, mediaRefs: [] },
    { stepRef: 'step-ref', kind: 'paid', priceMinor: 1_500, mediaRefs: [] },
    { stepRef: 'step-ref', kind: 'paid', priceMinor: 2_500, mediaRefs: [] },
  ],
  mediaValidated: true,
  descriptionValidated: true,
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

  it('pauses an unopened step when he comes back cold, never a refusal, and reminds him once (ADR 0156 § 1)', () => {
    // He fell asleep without opening it and writes « salut » the next day: the session cooled.
    const nextDay = new Date(NOW.getTime() + 20 * 3_600_000);
    const back = scriptTurn({
      ...input,
      now: nextDay,
      latest: offered,
      history: history([0, 1]),
      hotSession: false,
    });
    expect(back.decision).toMatchObject({ kind: 'end', status: 'stalled', unopened: { stepIndex: 1 } });
    expect(back.moved?.run.status).toBe('stalled');
    expect(back.moved?.run.steps.at(-1)?.outcome).toBe('sent');
    expect(back.moved?.events).toEqual([{ type: 'script_ended' }]);

    // His next message: the reminder was once, nothing is left to remind.
    const later = scriptTurn({
      ...input,
      now: new Date(nextDay.getTime() + 60_000),
      latest: back.moved?.run ?? null,
      history: history([0, 1]),
      hotSession: false,
    });
    expect(later.decision).not.toMatchObject({ kind: 'end' });

    // A clear no stays one, even cold.
    const no = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1]),
      hotSession: false,
      reply: 'refused',
    });
    expect(no.decision.kind).toBe('after_refusal');
  });

  it('never teases him about the step the same evening, when his heat fell because he came (eval passe-13)', () => {
    // « Merci pour ce soir » a few minutes after « j'ai fini »: the run pauses, nothing is recalled to him.
    const thanks = scriptTurn({ ...input, latest: offered, history: history([0, 1]), hotSession: false });
    expect(thanks.moved?.run.status).toBe('stalled');
    expect(thanks.decision).toEqual({ kind: 'end', status: 'stalled' });
  });

  it('pauses an opened, unbought step without a reminder when he comes back cold (ADR 0156 § 1)', () => {
    const opened = played([
      { type: 'step_sent', stepIndex: 0, at: BEFORE },
      { type: 'step_sent', stepIndex: 1, at: BEFORE },
      { type: 'step_opened', stepIndex: 1, at: BEFORE },
    ]);
    const back = scriptTurn({ ...input, latest: opened, history: history([0, 1]), hotSession: false });
    expect(back.decision).toEqual({ kind: 'end', status: 'stalled' });
  });

  it('ends the evening’s script when he came: no step goes, nothing recalled, never a refusal (passe 1, conversation 2)', () => {
    // « J'ai fini » with her paid step waiting: the run ends here, and the step he left is never recalled to him.
    const over = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1]),
      heCame: true,
      mayAct: false,
    });
    expect(over.decision).toEqual({ kind: 'end', status: 'stalled' });
    expect(over.moved?.run.status).toBe('stalled');
    expect(over.moved?.run.steps.at(-1)?.outcome).toBe('sent');
    // Even a message the brain reads as a no is no refusal right after he came.
    const no = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1]),
      heCame: true,
      mayAct: false,
      reply: 'refused',
    });
    expect(no.decision).toEqual({ kind: 'end', status: 'stalled' });
    // His next message, the next day: the run is history, nothing is recalled.
    const nextDay = new Date(NOW.getTime() + 20 * 3_600_000);
    const later = scriptTurn({
      ...input,
      now: nextDay,
      offer: { ...offer, now: nextDay },
      latest: over.moved?.run ?? null,
      history: history([0, 1]),
      hotSession: false,
    });
    expect(later.decision).not.toMatchObject({ kind: 'end' });
    // Only the teasing went: the run ends too, and the next step never goes.
    const next = scriptTurn({ ...input, latest: teased, history: history([0]), heCame: true, mayAct: false });
    expect(next.decision).toEqual({ kind: 'end', status: 'stalled' });
    expect(next.moved?.run.status).toBe('stalled');
  });

  it('il a joui après une étape achetée: nothing more is offered that evening (ADR 0156 § 6)', () => {
    // He bought step 1, nothing waits, and he says he came: the run ends there.
    const bought = played([
      { type: 'step_sent', stepIndex: 0, at: BEFORE },
      { type: 'step_sent', stepIndex: 1, at: BEFORE },
      { type: 'step_bought', stepIndex: 1, at: BEFORE },
    ]);
    const came = scriptTurn({
      ...input,
      latest: bought,
      history: history([0, 1], [1]),
      heCame: true,
      mayAct: false,
    });
    expect(came.decision).toEqual({ kind: 'end', status: 'stalled' });
    expect(came.moved?.run.status).toBe('stalled');
    // His heat climbs again a little later the same evening: step 2 never goes, and no script opens.
    const later = new Date(NOW.getTime() + 30 * 60_000);
    const again = scriptTurn({
      ...input,
      now: later,
      offer: { ...offer, now: later },
      latest: came.moved?.run ?? null,
      history: history([0, 1], [1]),
    });
    expect(again.decision.kind).not.toBe('send_step');
    expect(again.decision.kind).not.toBe('start');
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

describe('the next paid step waits in the tension after a purchase (passe 2 du 26/11, 43 and 46)', () => {
  const minutes = (count: number) => new Date(NOW.getTime() - count * 60_000);

  it('counts his messages on the run Reveal leaves: a purchase seen at this message is his first message after it', () => {
    // He just bought the step waiting; only Reveal says so, at this message (« Wow »).
    const turn = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1], [1]),
      reply: 'answers_step',
      hisMessagesAt: [minutes(30), minutes(25), NOW],
    });

    expect(turn.decision).toEqual({ kind: 'none', reason: 'in_tension' });
  });

  it('lets the next step go once he wrote a few messages since the purchase', () => {
    const bought = played([
      { type: 'step_sent', stepIndex: 0, at: BEFORE },
      { type: 'step_sent', stepIndex: 1, at: BEFORE },
      { type: 'step_bought', stepIndex: 1, at: minutes(10) },
    ]);
    const turn = scriptTurn({
      ...input,
      latest: bought,
      history: history([0, 1], [1]),
      hisMessagesAt: [minutes(12), minutes(5), NOW],
    });

    expect(turn.decision).toMatchObject({ kind: 'send_step', step: { stepIndex: 2 } });
  });

  it('keeps the count given when his messages’ times are not', () => {
    const turn = scriptTurn({
      ...input,
      latest: offered,
      history: history([0, 1], [1]),
      hisMessagesSinceBought: 3,
    });

    expect(turn.decision).toMatchObject({ kind: 'send_step', step: { stepIndex: 2 } });
  });
});
