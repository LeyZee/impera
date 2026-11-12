import { describe, expect, it } from 'vitest';

import type { OfferContext } from '../policy';
import {
  applyScriptRunEvent,
  catalogueScriptFaults,
  nextScriptStep,
  openScriptRun,
  permittedScripts,
  scriptStepsHeld,
  type CatalogueScript,
  type NextScriptStepInput,
  type ScriptRun,
  type ScriptRunEvent,
} from '../script-run';

const NOW = new Date('2026-11-12T21:00:00Z');
const at = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

/** A made-up script: teasing, a bridge, two paid steps. */
const NIGHT: CatalogueScript = {
  id: 'script-night',
  moment: 'night',
  description: 'Soirée en lingerie, de la douceur au plus chaud',
  steps: [
    { key: 'teasing', kind: 'free', priceCents: null },
    { key: 'pont-1', kind: 'bridge', priceCents: null },
    { key: 'etape-1', kind: 'paid', priceCents: 1_500 },
    { key: 'etape-2', kind: 'paid', priceCents: 2_500 },
  ],
  mediaValidated: true,
  touchesLimits: false,
};
const DAY: CatalogueScript = { ...NIGHT, id: 'script-day', moment: 'day' };
const BOTH: CatalogueScript = { ...NIGHT, id: 'script-both', moment: 'both' };

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
  latest: null,
  catalogue: [NIGHT, DAY],
  playedScriptIds: new Set(),
  moment: 'night',
  hotSession: true,
  brainPick: 'script-night',
  offer,
  careMode: false,
};

function play(events: readonly ScriptRunEvent[], script: CatalogueScript = NIGHT): ScriptRun {
  let run = openScriptRun(script.id, NOW);
  for (const event of events) {
    const result = applyScriptRunEvent(run, script, event);
    if (!result.ok) throw new Error(`${event.type}: ${result.fault}`);
    run = result.run;
  }
  return run;
}

const sent = (key: string, minutes: number): ScriptRunEvent => ({ type: 'step_sent', key, at: at(minutes) });

describe('catalogueScriptFaults', () => {
  it('accepts a playable script', () => {
    expect(catalogueScriptFaults(NIGHT)).toEqual([]);
  });

  it('refuses a paid step without a price, a price on an offered step, and a script that starts or ends on a bridge', () => {
    expect(catalogueScriptFaults({ ...NIGHT, steps: [] })).toEqual(['no_step']);
    expect(
      catalogueScriptFaults({
        ...NIGHT,
        steps: [
          { key: 'pont', kind: 'bridge', priceCents: null },
          { key: 'a', kind: 'paid', priceCents: null },
          { key: 'a', kind: 'free', priceCents: 300 },
          { key: 'fin', kind: 'bridge', priceCents: null },
        ],
      }),
    ).toEqual([
      'duplicate_key',
      'paid_without_price',
      'price_on_free_step',
      'starts_with_bridge',
      'bridge_at_edge',
    ]);
  });
});

describe('permittedScripts', () => {
  it('keeps her moment on her clock, never a script played to him, nor one with media not validated or touching her limits', () => {
    const catalogue = [
      NIGHT,
      DAY,
      BOTH,
      { ...NIGHT, id: 'not-validated', mediaValidated: false },
      { ...NIGHT, id: 'limits', touchesLimits: true },
      { ...NIGHT, id: 'broken', steps: [] },
    ];
    const ids = (moment: 'day' | 'night', played: string[] = []): string[] =>
      permittedScripts(catalogue, { moment, playedScriptIds: new Set(played) }).map((script) => script.id);
    expect(ids('night')).toEqual(['script-night', 'script-both']);
    expect(ids('day')).toEqual(['script-day', 'script-both']);
    expect(ids('night', ['script-night'])).toEqual(['script-both']);
  });
});

describe('applyScriptRunEvent', () => {
  it('sends the steps in order only: a bridge goes after an offered step, a paid step waits to be bought', () => {
    const run = play([sent('teasing', 1), sent('pont-1', 2), sent('etape-1', 3)]);
    expect(run.steps.map((step) => [step.key, step.outcome, step.priceCents])).toEqual([
      ['teasing', 'sent', null],
      ['pont-1', 'sent', null],
      ['etape-1', 'sent', 1_500],
    ]);
    expect(applyScriptRunEvent(run, NIGHT, sent('etape-2', 4))).toEqual({
      ok: false,
      fault: 'not_next_step',
    });
    expect(applyScriptRunEvent(openScriptRun(NIGHT.id, NOW), NIGHT, sent('etape-1', 1))).toEqual({
      ok: false,
      fault: 'not_next_step',
    });
  });

  it('climbs once a paid step is bought, and ends bought out after the last one', () => {
    const bought = play([
      sent('teasing', 1),
      sent('pont-1', 2),
      sent('etape-1', 3),
      { type: 'step_opened', key: 'etape-1', at: at(4) },
      { type: 'step_bought', key: 'etape-1', at: at(5) },
    ]);
    expect(bought.status).toBe('open');
    const result = applyScriptRunEvent(bought, NIGHT, sent('etape-2', 6));
    expect(result.ok).toBe(true);
    const done = play([
      sent('teasing', 1),
      sent('pont-1', 2),
      sent('etape-1', 3),
      { type: 'step_bought', key: 'etape-1', at: at(5) },
      sent('etape-2', 6),
      { type: 'step_bought', key: 'etape-2', at: at(7) },
    ]);
    expect(done.status).toBe('bought_out');
    expect(done.endedAt).toEqual(at(7));
  });

  it('never buys an offered step', () => {
    const run = play([sent('teasing', 1)]);
    expect(applyScriptRunEvent(run, NIGHT, { type: 'step_bought', key: 'teasing', at: at(2) })).toEqual({
      ok: false,
      fault: 'not_paid',
    });
  });

  it('takes a paid step ignored two messages in a row as a refusal (Charles, 12/11)', () => {
    const waiting = play([sent('teasing', 1), sent('pont-1', 2), sent('etape-1', 3)]);
    const once = play([
      sent('teasing', 1),
      sent('pont-1', 2),
      sent('etape-1', 3),
      { type: 'fan_message', aboutTheStep: false, at: at(4) },
    ]);
    expect(once.status).toBe('open');
    expect(once.ignoredMessages).toBe(1);
    const twice = applyScriptRunEvent(once, NIGHT, { type: 'fan_message', aboutTheStep: false, at: at(5) });
    expect(twice.ok && twice.run.status).toBe('refused');
    expect(twice.ok && twice.run.steps.at(-1)?.outcome).toBe('refused');
    // A message about the step in between starts the count again.
    const back = play([
      sent('teasing', 1),
      sent('pont-1', 2),
      sent('etape-1', 3),
      { type: 'fan_message', aboutTheStep: false, at: at(4) },
      { type: 'fan_message', aboutTheStep: true, at: at(5) },
      { type: 'fan_message', aboutTheStep: false, at: at(6) },
    ]);
    expect(back.status).toBe('open');
    // Nothing paid waiting: his messages count for nothing.
    expect(waiting.ignoredMessages).toBe(0);
    const free = play([sent('teasing', 1), { type: 'fan_message', aboutTheStep: false, at: at(2) }]);
    expect(free.ignoredMessages).toBe(0);
  });

  it('ends on a clear refusal, a cooled session, no answer, or a human taking over, and then takes no event', () => {
    const waiting = play([sent('teasing', 1), sent('pont-1', 2), sent('etape-1', 3)]);
    const refused = applyScriptRunEvent(waiting, NIGHT, { type: 'refused', at: at(4) });
    expect(refused.ok && refused.run.status).toBe('refused');
    expect(applyScriptRunEvent(play([sent('teasing', 1)]), NIGHT, { type: 'refused', at: at(2) })).toEqual({
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
    expect(applyScriptRunEvent(human.run, NIGHT, sent('etape-2', 6))).toEqual({
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
    expect(nextScriptStep(base)).toEqual({ kind: 'start', script: NIGHT, step: NIGHT.steps[0] });
  });

  it('opens nothing when the brain picked none, or one outside the list (fail closed)', () => {
    expect(nextScriptStep({ ...base, brainPick: null })).toEqual({ kind: 'none', reason: 'no_pick' });
    expect(nextScriptStep({ ...base, brainPick: 'script-day' })).toEqual({ kind: 'none', reason: 'no_pick' });
    expect(nextScriptStep({ ...base, playedScriptIds: new Set(['script-night']) })).toEqual({
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
    const stalled = play([sent('teasing', -120), { type: 'session_cooled', at: at(-90) }]);
    expect(
      nextScriptStep({
        ...base,
        latest: { run: { ...stalled, startedAt: at(-120) }, script: NIGHT },
        catalogue: [NIGHT, BOTH],
        playedScriptIds: new Set(['script-night']),
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
    const teased = play([sent('teasing', -2)]);
    expect(nextScriptStep({ ...base, latest: { run: teased, script: NIGHT } })).toEqual({
      kind: 'send_step',
      step: NIGHT.steps[1],
    });
    const bridged = play([sent('teasing', -3), sent('pont-1', -2)]);
    expect(
      nextScriptStep({
        ...base,
        latest: { run: bridged, script: NIGHT },
        offer: { ...offer, lastOfferAt: at(-30) },
      }),
    ).toEqual({ kind: 'send_step', step: NIGHT.steps[2] });
  });

  it('waits on a paid step not bought, and goes on once it is', () => {
    const waiting = play([sent('teasing', -3), sent('pont-1', -2), sent('etape-1', -1)]);
    expect(nextScriptStep({ ...base, latest: { run: waiting, script: NIGHT } })).toEqual({
      kind: 'wait',
      step: waiting.steps[2],
    });
    const bought = play([
      sent('teasing', -4),
      sent('pont-1', -3),
      sent('etape-1', -2),
      { type: 'step_bought', key: 'etape-1', at: at(-1) },
    ]);
    expect(nextScriptStep({ ...base, latest: { run: bought, script: NIGHT } })).toEqual({
      kind: 'send_step',
      step: NIGHT.steps[3],
    });
  });

  it('holds the next step of a cold session, a held fan, or a paid step the policy refuses', () => {
    const teased = play([sent('teasing', -2)]);
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
    const bridged = play([sent('teasing', -3), sent('pont-1', -2)]);
    expect(
      nextScriptStep({
        ...base,
        latest: { run: bridged, script: NIGHT },
        offer: { ...offer, risks: ['distress'] },
      }),
    ).toEqual({ kind: 'none', reason: 'risk' });
  });

  it('says once that the run ended at this message: after a refusal, its reaction; else its end', () => {
    const waiting = play([sent('teasing', -3), sent('pont-1', -2), sent('etape-1', -1)]);
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
        playedScriptIds: new Set(['script-night']),
      }),
    ).toEqual({ kind: 'none', reason: 'cooldown' });
  });

  it('never resumes a run in another session: a stalled run is history, the next script is a new one', () => {
    const stalled = play([sent('teasing', -600), { type: 'session_cooled', at: at(-590) }]);
    const later = at(12 * 60);
    expect(
      nextScriptStep({
        ...base,
        now: later,
        offer: { ...offer, now: later },
        latest: { run: { ...stalled, startedAt: at(-600) }, script: NIGHT },
        catalogue: [NIGHT, BOTH],
        playedScriptIds: new Set(['script-night']),
        brainPick: 'script-both',
      }),
    ).toEqual({ kind: 'start', script: BOTH, step: BOTH.steps[0] });
  });
});
