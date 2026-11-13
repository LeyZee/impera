import { describe, expect, it } from 'vitest';

import type { OfferContext } from '../policy';
import {
  applyScriptRunEvent,
  nextScriptStep,
  openScriptRun,
  permittedScripts,
  platformScriptFaults,
  playedScriptRefs,
  reconcileScriptRun,
  scriptStepsHeld,
  stepPriceCheck,
  type NextScriptStepInput,
  type PlatformScriptView,
  type ScriptHistoryView,
  type ScriptRun,
  type ScriptRunEvent,
} from '../script-run';

const NOW = new Date('2026-11-12T21:00:00Z');
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

/** A made-up script: teasing (0), a bridge (1), two paid steps (2, 3). */
const NIGHT: PlatformScriptView = {
  scriptRef: 'script-night',
  moment: 'night',
  description: 'Soirée en lingerie, de la douceur au plus chaud',
  steps: [
    { kind: 'free', priceMinor: null },
    { kind: 'bridge', priceMinor: null },
    { kind: 'paid', priceMinor: 1_500 },
    { kind: 'paid', priceMinor: 2_500 },
  ],
  mediaValidated: true,
  touchesLimits: false,
};
const DAY: PlatformScriptView = { ...NIGHT, scriptRef: 'script-day', moment: 'day' };
const BOTH: PlatformScriptView = { ...NIGHT, scriptRef: 'script-both', moment: null };

const NO_HISTORY: ScriptHistoryView = { scripts: [] };
const history = (...entries: [string, number[], number[]?][]): ScriptHistoryView => ({
  scripts: entries.map(([scriptRef, sentStepIndexes, boughtStepIndexes = []]) => ({
    scriptRef,
    sentStepIndexes,
    boughtStepIndexes,
  })),
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

const base: NextScriptStepInput = {
  now: NOW,
  conversationRef: 'conv-demo',
  latest: null,
  catalogue: [NIGHT, DAY],
  history: NO_HISTORY,
  moment: 'night',
  hotSession: true,
  brainPick: 'script-night',
  offer,
  careMode: false,
};

function play(events: readonly ScriptRunEvent[], script: PlatformScriptView = NIGHT): ScriptRun {
  let run = openScriptRun(script.scriptRef, NOW);
  for (const event of events) {
    const result = applyScriptRunEvent(run, script, event);
    if (!result.ok) throw new Error(`${event.type}: ${result.fault}`);
    run = result.run;
  }
  return run;
}

const sent = (stepIndex: number, minutes: number): ScriptRunEvent => ({
  type: 'step_sent',
  stepIndex,
  at: at(minutes),
});

const toSend = (script: PlatformScriptView, stepIndex: number) => ({
  scriptRef: script.scriptRef,
  stepIndex,
  kind: script.steps[stepIndex]?.kind,
  priceMinor: script.steps[stepIndex]?.priceMinor,
  idempotencyKey: `script-step:conv-demo:${script.scriptRef}:${String(stepIndex)}`,
});

describe('platformScriptFaults', () => {
  it('accepts a playable script', () => {
    expect(platformScriptFaults(NIGHT)).toEqual([]);
  });

  it('refuses a paid step without a price, a price on an offered step, and a script that starts or ends on a bridge', () => {
    expect(platformScriptFaults({ ...NIGHT, steps: [] })).toEqual(['no_step']);
    expect(
      platformScriptFaults({
        ...NIGHT,
        steps: [
          { kind: 'bridge', priceMinor: null },
          { kind: 'paid', priceMinor: null },
          { kind: 'free', priceMinor: 300 },
          { kind: 'bridge', priceMinor: null },
        ],
      }),
    ).toEqual(['paid_without_price', 'price_on_free_step', 'starts_with_bridge', 'bridge_at_edge']);
  });
});

describe('permittedScripts', () => {
  it('keeps her moment on her clock, never a script played to him, nor one with media not validated or touching her limits', () => {
    const catalogue = [
      NIGHT,
      DAY,
      BOTH,
      { ...NIGHT, scriptRef: 'not-validated', mediaValidated: false },
      { ...NIGHT, scriptRef: 'limits', touchesLimits: true },
      { ...NIGHT, scriptRef: 'broken', steps: [] },
    ];
    const ids = (moment: 'day' | 'night', played: string[] = []): string[] =>
      permittedScripts(catalogue, { moment, played: new Set(played) }).map((script) => script.scriptRef);
    expect(ids('night')).toEqual(['script-night', 'script-both']);
    expect(ids('day')).toEqual(['script-day', 'script-both']);
    expect(ids('night', ['script-night'])).toEqual(['script-both']);
  });
});

describe('applyScriptRunEvent', () => {
  it('sends the steps in order only: a bridge goes after an offered step, a paid step waits to be bought', () => {
    const run = play([sent(0, 1), sent(1, 2), sent(2, 3)]);
    expect(run.steps.map((step) => [step.stepIndex, step.outcome, step.priceMinor])).toEqual([
      [0, 'sent', null],
      [1, 'sent', null],
      [2, 'sent', 1_500],
    ]);
    expect(applyScriptRunEvent(run, NIGHT, sent(3, 4))).toEqual({
      ok: false,
      fault: 'not_next_step',
    });
    expect(applyScriptRunEvent(openScriptRun(NIGHT.scriptRef, NOW), NIGHT, sent(2, 1))).toEqual({
      ok: false,
      fault: 'not_next_step',
    });
  });

  it('climbs once a paid step is bought, and ends bought out after the last one', () => {
    const bought = play([
      sent(0, 1),
      sent(1, 2),
      sent(2, 3),
      { type: 'step_opened', stepIndex: 2, at: at(4) },
      { type: 'step_bought', stepIndex: 2, at: at(5) },
    ]);
    expect(bought.status).toBe('open');
    const result = applyScriptRunEvent(bought, NIGHT, sent(3, 6));
    expect(result.ok).toBe(true);
    const done = play([
      sent(0, 1),
      sent(1, 2),
      sent(2, 3),
      { type: 'step_bought', stepIndex: 2, at: at(5) },
      sent(3, 6),
      { type: 'step_bought', stepIndex: 3, at: at(7) },
    ]);
    expect(done.status).toBe('bought_out');
    expect(done.endedAt).toEqual(at(7));
  });

  it('never buys an offered step', () => {
    const run = play([sent(0, 1)]);
    expect(applyScriptRunEvent(run, NIGHT, { type: 'step_bought', stepIndex: 0, at: at(2) })).toEqual({
      ok: false,
      fault: 'not_paid',
    });
  });

  it('takes a paid step ignored two messages in a row as a refusal (Charles, 12/11)', () => {
    const waiting = play([sent(0, 1), sent(1, 2), sent(2, 3)]);
    const once = play([
      sent(0, 1),
      sent(1, 2),
      sent(2, 3),
      { type: 'fan_message', aboutTheStep: false, at: at(4) },
    ]);
    expect(once.status).toBe('open');
    expect(once.ignoredMessages).toBe(1);
    const twice = applyScriptRunEvent(once, NIGHT, { type: 'fan_message', aboutTheStep: false, at: at(5) });
    expect(twice.ok && twice.run.status).toBe('refused');
    expect(twice.ok && twice.run.steps.at(-1)?.outcome).toBe('refused');
    // A message about the step in between starts the count again.
    const back = play([
      sent(0, 1),
      sent(1, 2),
      sent(2, 3),
      { type: 'fan_message', aboutTheStep: false, at: at(4) },
      { type: 'fan_message', aboutTheStep: true, at: at(5) },
      { type: 'fan_message', aboutTheStep: false, at: at(6) },
    ]);
    expect(back.status).toBe('open');
    // Nothing paid waiting: his messages count for nothing.
    expect(waiting.ignoredMessages).toBe(0);
    const free = play([sent(0, 1), { type: 'fan_message', aboutTheStep: false, at: at(2) }]);
    expect(free.ignoredMessages).toBe(0);
  });

  it('ends on a clear refusal, a cooled session, no answer, or a human taking over, and then takes no event', () => {
    const waiting = play([sent(0, 1), sent(1, 2), sent(2, 3)]);
    const refused = applyScriptRunEvent(waiting, NIGHT, { type: 'refused', at: at(4) });
    expect(refused.ok && refused.run.status).toBe('refused');
    expect(applyScriptRunEvent(play([sent(0, 1)]), NIGHT, { type: 'refused', at: at(2) })).toEqual({
      ok: false,
      fault: 'nothing_waiting',
    });
    const cooled = applyScriptRunEvent(waiting, NIGHT, { type: 'session_cooled', at: at(30) });
    expect(cooled.ok && cooled.run.status).toBe('stalled');
    const unanswered = applyScriptRunEvent(waiting, NIGHT, { type: 'no_answer', at: at(60) });
    expect(unanswered.ok && unanswered.run.status).toBe('stalled');
    const human = applyScriptRunEvent(waiting, NIGHT, { type: 'human_took_over', at: at(5) });
    expect(human.ok && human.run.status).toBe('closed_by_human');
    if (!human.ok) return;
    expect(applyScriptRunEvent(human.run, NIGHT, sent(3, 6))).toEqual({
      ok: false,
      fault: 'run_closed',
    });
  });
});

describe('scriptStepsHeld', () => {
  it('holds the steps of a fan with sales frozen, fragile, not to write to, or in care mode', () => {
    expect(scriptStepsHeld({}, false)).toBe(false);
    expect(scriptStepsHeld({}, true)).toBe(true);
    expect(scriptStepsHeld({ fragile: true }, false)).toBe(true);
    expect(scriptStepsHeld({ doNotContact: true }, false)).toBe(true);
    expect(
      scriptStepsHeld({ salesFrozen: { reason: 'spending_limit', since: '2026-11-01T10:00:00Z' } }, false),
    ).toBe(true);
  });
});

describe('nextScriptStep', () => {
  it('opens the script the brain picked among those permitted, on its first step', () => {
    expect(nextScriptStep(base)).toEqual({ kind: 'start', script: NIGHT, step: toSend(NIGHT, 0) });
  });

  it('opens nothing when the brain picked none, or one outside the list (fail closed)', () => {
    expect(nextScriptStep({ ...base, brainPick: null })).toEqual({ kind: 'none', reason: 'no_pick' });
    expect(nextScriptStep({ ...base, brainPick: 'script-day' })).toEqual({ kind: 'none', reason: 'no_pick' });
    expect(nextScriptStep({ ...base, history: history(['script-night', [0]]) })).toEqual({
      kind: 'none',
      reason: 'no_script',
    });
  });

  it('sends the teasing through the policy like a paid step: never before the cooldown (Charles, 12/11)', () => {
    expect(nextScriptStep({ ...base, offer: { ...offer, lastOfferAt: at(-60) } })).toEqual({
      kind: 'none',
      reason: 'cooldown',
    });
    // A script that stalled on its teasing still counts: its start opens the cooldown.
    const stalled = play([sent(0, -120), { type: 'session_cooled', at: at(-90) }]);
    expect(
      nextScriptStep({
        ...base,
        latest: { run: { ...stalled, startedAt: at(-120) }, script: NIGHT },
        catalogue: [NIGHT, BOTH],
        history: history(['script-night', [0]]),
        brainPick: 'script-both',
      }),
    ).toEqual({ kind: 'none', reason: 'cooldown' });
    expect(nextScriptStep({ ...base, offer: { ...offer, desire: 50 } })).toEqual({
      kind: 'none',
      reason: 'low_desire',
    });
    expect(nextScriptStep({ ...base, careMode: true })).toEqual({ kind: 'none', reason: 'held' });
  });

  it('climbs the open run in the same hot session, past the cooldown that only parts two scripts', () => {
    const teased = play([sent(0, -2)]);
    expect(nextScriptStep({ ...base, latest: { run: teased, script: NIGHT } })).toEqual({
      kind: 'send_step',
      step: toSend(NIGHT, 1),
    });
    const bridged = play([sent(0, -3), sent(1, -2)]);
    expect(
      nextScriptStep({
        ...base,
        latest: { run: bridged, script: NIGHT },
        offer: { ...offer, lastOfferAt: at(-30) },
      }),
    ).toEqual({ kind: 'send_step', step: toSend(NIGHT, 2) });
  });

  it('waits on a paid step not bought, and goes on once it is', () => {
    const waiting = play([sent(0, -3), sent(1, -2), sent(2, -1)]);
    expect(nextScriptStep({ ...base, latest: { run: waiting, script: NIGHT } })).toEqual({
      kind: 'wait',
      step: waiting.steps[2],
    });
    const bought = play([
      sent(0, -4),
      sent(1, -3),
      sent(2, -2),
      { type: 'step_bought', stepIndex: 2, at: at(-1) },
    ]);
    expect(nextScriptStep({ ...base, latest: { run: bought, script: NIGHT } })).toEqual({
      kind: 'send_step',
      step: toSend(NIGHT, 3),
    });
  });

  it('holds the next step of a cold session, a held fan, or a paid step the policy refuses', () => {
    const teased = play([sent(0, -2)]);
    const latest = { run: teased, script: NIGHT };
    expect(nextScriptStep({ ...base, latest, hotSession: false })).toEqual({
      kind: 'none',
      reason: 'cold_session',
    });
    expect(
      nextScriptStep({ ...base, latest, offer: { ...offer, flags: { ...offer.flags, fragile: true } } }),
    ).toEqual({
      kind: 'none',
      reason: 'held',
    });
    const bridged = play([sent(0, -3), sent(1, -2)]);
    expect(
      nextScriptStep({
        ...base,
        latest: { run: bridged, script: NIGHT },
        offer: { ...offer, risks: ['distress'] },
      }),
    ).toEqual({ kind: 'none', reason: 'risk' });
  });

  it('says once that the run ended at this message: after a refusal, its reaction; else its end', () => {
    const waiting = play([sent(0, -3), sent(1, -2), sent(2, -1)]);
    const refused = applyScriptRunEvent(waiting, NIGHT, { type: 'refused', at: NOW });
    if (!refused.ok) throw new Error('refused');
    expect(nextScriptStep({ ...base, latest: { run: refused.run, script: NIGHT } })).toEqual({
      kind: 'after_refusal',
      step: refused.run.steps[2],
    });
    const human = applyScriptRunEvent(waiting, NIGHT, { type: 'human_took_over', at: NOW });
    if (!human.ok) throw new Error('human');
    expect(nextScriptStep({ ...base, latest: { run: human.run, script: NIGHT } })).toEqual({
      kind: 'end',
      status: 'closed_by_human',
    });
    // At his next message, the ended run is history: a new script goes through the policy (here, the cooldown).
    expect(
      nextScriptStep({
        ...base,
        now: at(1),
        offer: { ...offer, now: at(1) },
        latest: { run: refused.run, script: NIGHT },
        history: history(['script-night', [0]]),
      }),
    ).toEqual({ kind: 'none', reason: 'cooldown' });
  });

  it('never resumes a run in another session: a stalled run is history, the next script is a new one', () => {
    const stalled = play([sent(0, -600), { type: 'session_cooled', at: at(-590) }]);
    const later = at(12 * 60);
    expect(
      nextScriptStep({
        ...base,
        now: later,
        offer: { ...offer, now: later },
        latest: { run: { ...stalled, startedAt: at(-600) }, script: NIGHT },
        catalogue: [NIGHT, BOTH],
        history: history(['script-night', [0]]),
        brainPick: 'script-both',
      }),
    ).toEqual({ kind: 'start', script: BOTH, step: toSend(BOTH, 0) });
  });
});

describe("Reveal's script history (ADR 0018 § 5)", () => {
  it('sells nothing when the history could not be read', () => {
    expect(nextScriptStep({ ...base, history: null })).toEqual({ kind: 'none', reason: 'no_history' });
    const teased = play([sent(0, -2)]);
    expect(nextScriptStep({ ...base, history: null, latest: { run: teased, script: NIGHT } })).toEqual({
      kind: 'none',
      reason: 'no_history',
    });
  });

  it('takes as played every script Reveal says sent him a step, whatever our runs say', () => {
    expect([
      ...playedScriptRefs(history(['script-night', [0]], ['script-day', []], ['script-both', [], [2]])),
    ]).toEqual(['script-night', 'script-both']);
    expect(nextScriptStep({ ...base, history: history(['script-night', [0, 1]]) })).toEqual({
      kind: 'none',
      reason: 'no_script',
    });
  });

  it('lets Reveal win on what was sent and bought, and keeps the refusal that is the run’s own', () => {
    // Reveal saw the bridge and the first paid step bought; the run had only the teasing.
    const teased = play([sent(0, -3)]);
    const caught = reconcileScriptRun(teased, NIGHT, history(['script-night', [0, 1, 2], [2]]), NOW);
    expect(caught.steps.map((step) => [step.stepIndex, step.outcome])).toEqual([
      [0, 'sent'],
      [1, 'sent'],
      [2, 'bought'],
    ]);
    expect(caught.steps[0]?.sentAt).toEqual(at(-3));
    expect(caught.steps[1]?.sentAt).toEqual(NOW);
    expect(nextScriptStep({ ...base, latest: { run: caught, script: NIGHT } })).toEqual({
      kind: 'send_step',
      step: toSend(NIGHT, 3),
    });
    // The run thinks the bridge left; Reveal does not know it: it is decided again, under the same key.
    const bridged = play([sent(0, -3), sent(1, -2)]);
    const back = reconcileScriptRun(bridged, NIGHT, history(['script-night', [0]]), NOW);
    expect(back.steps.map((step) => step.stepIndex)).toEqual([0]);
    expect(nextScriptStep({ ...base, latest: { run: back, script: NIGHT } })).toEqual({
      kind: 'send_step',
      step: toSend(NIGHT, 1),
    });
    // The last paid step bought on Reveal ends the run bought out.
    const last = play([
      sent(0, -5),
      sent(1, -4),
      sent(2, -3),
      { type: 'step_bought', stepIndex: 2, at: at(-2) },
      sent(3, -1),
    ]);
    const out = reconcileScriptRun(last, NIGHT, history(['script-night', [0, 1, 2, 3], [2, 3]]), NOW);
    expect(out.status).toBe('bought_out');
    expect(out.endedAt).toEqual(NOW);
    // A refused run is left as it is: Reveal does not know a refusal.
    const waiting = play([sent(0, -3), sent(1, -2), sent(2, -1)]);
    const refused = applyScriptRunEvent(waiting, NIGHT, { type: 'refused', at: NOW });
    if (!refused.ok) throw new Error(refused.fault);
    expect(reconcileScriptRun(refused.run, NIGHT, NO_HISTORY, at(1))).toBe(refused.run);
  });

  it('never sends a step whose price changed on Reveal', () => {
    expect(stepPriceCheck({ priceMinor: 1_500 }, { kind: 'paid', priceMinor: 1_500 })).toBe('send');
    expect(stepPriceCheck({ priceMinor: 1_500 }, { kind: 'paid', priceMinor: 1_900 })).toBe('price_mismatch');
    expect(stepPriceCheck({ priceMinor: null }, { kind: 'free', priceMinor: null })).toBe('send');
  });
});

describe('nextScriptStep: the gate before the first teaser (ADR 0103 § 11-12)', () => {
  it('starts no script, teaser included, while a condition is missing: it waits on the first one', () => {
    expect(
      nextScriptStep({
        ...base,
        startGate: { open: false, missing: ['not_sexualizing', 'availability_unconfirmed'] },
      }),
    ).toEqual({ kind: 'wait', reason: 'not_sexualizing' });
    expect(
      nextScriptStep({ ...base, startGate: { open: false, missing: ['availability_unconfirmed'] } }),
    ).toEqual({ kind: 'wait', reason: 'availability_unconfirmed' });
    expect(nextScriptStep({ ...base, startGate: { open: true } })).toEqual({
      kind: 'start',
      script: NIGHT,
      step: toSend(NIGHT, 0),
    });
  });

  it('lets a block of the policy speak first: a fan in his cooldown is not told he is not free', () => {
    expect(
      nextScriptStep({
        ...base,
        offer: { ...offer, lastOfferAt: at(-60) },
        startGate: { open: false, missing: ['availability_unconfirmed'] },
      }),
    ).toEqual({ kind: 'none', reason: 'cooldown' });
  });

  it('pauses an open run while he is not free: no step, and the gate does not apply to it', () => {
    const teased = play([sent(0, -2)]);
    const open = { ...base, latest: { run: teased, script: NIGHT } };
    expect(nextScriptStep({ ...open, availability: 'no' })).toEqual({
      kind: 'wait',
      reason: 'availability_unconfirmed',
    });
    expect(
      nextScriptStep({
        ...open,
        availability: 'unknown',
        startGate: { open: false, missing: ['availability_unconfirmed'] },
      }),
    ).toEqual({ kind: 'send_step', step: toSend(NIGHT, 1) });
  });
});
