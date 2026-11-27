import { describe, expect, it } from 'vitest';

import type { OfferContext } from '../policy';
import {
  applyScriptRunEvent,
  mayOpenScript,
  nextScriptStep,
  openScriptRun,
  permittedScripts,
  platformScriptFaults,
  playableFamiliesIn,
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
    { stepRef: 'step-ref', kind: 'free', priceMinor: null, mediaRefs: [] },
    { stepRef: 'step-ref', kind: 'bridge', priceMinor: null, mediaRefs: [] },
    { stepRef: 'step-ref', kind: 'paid', priceMinor: 1_500, mediaRefs: [] },
    { stepRef: 'step-ref', kind: 'paid', priceMinor: 2_500, mediaRefs: [] },
  ],
  mediaValidated: true,
  descriptionValidated: true,
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
  stepRef: script.steps[stepIndex]?.stepRef,
  kind: script.steps[stepIndex]?.kind,
  priceMinor: script.steps[stepIndex]?.priceMinor,
  idempotencyKey: `script-step:conv-demo:${script.scriptRef}:1:${String(stepIndex)}`,
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
          { stepRef: 'step-ref', kind: 'bridge', priceMinor: null, mediaRefs: [] },
          { stepRef: 'step-ref', kind: 'paid', priceMinor: null, mediaRefs: [] },
          { stepRef: 'step-ref', kind: 'free', priceMinor: 300, mediaRefs: [] },
          { stepRef: 'step-ref', kind: 'bridge', priceMinor: null, mediaRefs: [] },
        ],
      }),
    ).toEqual(['paid_without_price', 'price_on_free_step', 'starts_with_bridge', 'bridge_at_edge']);
  });
});

describe('permittedScripts', () => {
  const sentTo = (...scripts: [string, number[]][]): ScriptHistoryView => ({
    scripts: scripts.map(([scriptRef, sent]) => ({
      scriptRef,
      sentStepIndexes: sent,
      boughtStepIndexes: [],
    })),
  });

  it('keeps her moment on her clock, never a script played to him, nor one with media or description not validated or touching her limits', () => {
    const catalogue = [
      NIGHT,
      DAY,
      BOTH,
      { ...NIGHT, scriptRef: 'not-validated', mediaValidated: false },
      { ...NIGHT, scriptRef: 'description-not-validated', descriptionValidated: false },
      { ...NIGHT, scriptRef: 'limits', touchesLimits: true },
      { ...NIGHT, scriptRef: 'broken', steps: [] },
    ];
    const ids = (moment: 'day' | 'night', history: ScriptHistoryView = NO_HISTORY): string[] =>
      permittedScripts(catalogue, { moment, history }).map((script) => script.scriptRef);
    expect(ids('night')).toEqual(['script-night', 'script-both']);
    expect(ids('day')).toEqual(['script-day', 'script-both']);
    expect(ids('night', sentTo(['script-night', [0]]))).toEqual(['script-both']);
  });

  it('never offers a script with a media he already received through another one, sent or bought', () => {
    const withMedia = (scriptRef: string, mediaRefs: string[]): PlatformScriptView => ({
      ...BOTH,
      scriptRef,
      steps: [
        { stepRef: 'step-ref', kind: 'free', priceMinor: null, mediaRefs: [] },
        { stepRef: 'step-ref', kind: 'paid', priceMinor: 1_500, mediaRefs },
      ],
    });
    const catalogue = [
      withMedia('first', ['media-a', 'media-b']),
      withMedia('shares-a', ['media-a']),
      withMedia('own', ['media-c']),
    ];
    const ids = (history: ScriptHistoryView): string[] =>
      permittedScripts(catalogue, { moment: 'night', history }).map((script) => script.scriptRef);
    // Only the teaser of « first » went: its paid media did not.
    expect(ids(sentTo(['first', [0]]))).toEqual(['shares-a', 'own']);
    expect(ids(sentTo(['first', [0, 1]]))).toEqual(['own']);
    expect(ids({ scripts: [{ scriptRef: 'first', sentStepIndexes: [], boughtStepIndexes: [1] }] })).toEqual([
      'own',
    ]);
  });

  it('reads nothing received from a step the catalogue no longer holds: only its own script is ruled out', () => {
    const catalogue = [
      {
        ...BOTH,
        steps: [{ stepRef: 'step-ref', kind: 'free' as const, priceMinor: null, mediaRefs: ['media-a'] }],
      },
    ];
    const ids = (history: ScriptHistoryView): string[] =>
      permittedScripts(catalogue, { moment: 'night', history }).map((script) => script.scriptRef);
    expect(ids(sentTo(['gone', [0]]))).toEqual(['script-both']);
    expect(ids(sentTo(['script-night', [9]]))).toEqual(['script-both']);
  });
});

describe('his language (ADR 0168 § 8)', () => {
  const FR: PlatformScriptView = { ...BOTH, scriptRef: 'lingerie-fr', family: 'lingerie' };
  const EN: PlatformScriptView = {
    ...BOTH,
    scriptRef: 'lingerie-en',
    family: 'lingerie',
    language: 'english',
  };
  const SHOWER_EN: PlatformScriptView = { ...BOTH, scriptRef: 'shower-en', language: 'english' };
  const catalogue = [FR, EN, SHOWER_EN, NIGHT];
  const ids = (
    language: 'french' | 'english' | 'italian' | undefined,
    played: ScriptHistoryView = NO_HISTORY,
  ) =>
    permittedScripts(catalogue, {
      moment: 'night',
      history: played,
      ...(language !== undefined && { language }),
    }).map((script) => script.scriptRef);

  it('opens only a script written in his language; a script that says none is French, and so is a fan without one', () => {
    expect(ids('english')).toEqual(['lingerie-en', 'shower-en']);
    expect(ids('french')).toEqual(['lingerie-fr', 'script-night']);
    expect(ids(undefined)).toEqual(['lingerie-fr', 'script-night']);
    expect(ids('italian')).toEqual([]);
  });

  it('plays a family once: the French version received, the English one is not a new script for him', () => {
    expect(ids('english', history(['lingerie-fr', [0]]))).toEqual(['shower-en']);
    expect(ids('french', history(['lingerie-en', [0]]))).toEqual(['script-night']);
  });

  it('opens no script at all when code reads his language as one it does not know', () => {
    expect(permittedScripts(catalogue, { moment: 'night', history: NO_HISTORY, language: null })).toEqual([]);
    expect(nextScriptStep({ ...base, catalogue, brainPick: 'lingerie-fr', language: null })).toMatchObject({
      kind: 'none',
    });
  });

  it('decides no start without a version in his language', () => {
    expect(nextScriptStep({ ...base, catalogue, brainPick: 'lingerie-fr', language: 'italian' })).toEqual({
      kind: 'none',
      reason: 'scripts_exhausted',
    });
    expect(nextScriptStep({ ...base, catalogue, brainPick: 'lingerie-en', language: 'english' }).kind).toBe(
      'start',
    );
  });

  it('counts her playable stock in his language by family, a version in another language never counting twice', () => {
    const versions = [
      FR,
      { ...FR, scriptRef: 'lingerie-fr-bis' },
      EN,
      SHOWER_EN,
      { ...SHOWER_EN, scriptRef: 'broken-en', family: 'broken', steps: [] },
    ];
    expect(playableFamiliesIn(versions, 'french')).toBe(1);
    expect(playableFamiliesIn(versions, 'english')).toBe(2);
    expect(playableFamiliesIn(versions, 'italian')).toBe(0);
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
      reason: 'scripts_exhausted',
    });
  });

  it('says no script is left only where one would open, and from a catalogue that has some (ADR 0150 § 9)', () => {
    const played = history(['script-night', [0]]);
    expect(nextScriptStep({ ...base, catalogue: [], history: played })).toEqual({
      kind: 'none',
      reason: 'no_script',
    });
    expect(nextScriptStep({ ...base, history: played, careMode: true })).toEqual({
      kind: 'none',
      reason: 'held',
    });
    expect(
      nextScriptStep({
        ...base,
        history: played,
        startGate: { open: false, missing: ['availability_unconfirmed'] },
      }),
    ).toEqual({ kind: 'wait', reason: 'availability_unconfirmed' });
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
    ).toMatchObject({ kind: 'send_step', step: toSend(NIGHT, 2) });
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
    expect(nextScriptStep({ ...base, latest: { run: bought, script: NIGHT } })).toMatchObject({
      kind: 'send_step',
      step: toSend(NIGHT, 3),
    });
  });

  it('keeps him a few messages in the tension after he bought, before the next paid step (passe 04, guide 26/11)', () => {
    const bought = play([
      sent(0, -4),
      sent(1, -3),
      sent(2, -2),
      { type: 'step_bought', stepIndex: 2, at: at(-1) },
    ]);
    const latest = { run: bought, script: NIGHT };
    expect(nextScriptStep({ ...base, latest, hisMessagesSinceBought: 1 })).toEqual({
      kind: 'none',
      reason: 'in_tension',
    });
    expect(nextScriptStep({ ...base, latest, hisMessagesSinceBought: 2 })).toMatchObject({
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

describe('nextScriptStep after a script he bought out (eval passe-1, 21/11)', () => {
  /** He bought the whole night script, `minutesAgo` before now: its run, as Reveal and our journal hold it. */
  const boughtOut = (minutesAgo: number): ScriptRun => {
    const run = play([
      sent(0, -minutesAgo),
      sent(1, -minutesAgo + 1),
      sent(2, -minutesAgo + 2),
      { type: 'step_bought', stepIndex: 2, at: at(-minutesAgo + 3) },
      sent(3, -minutesAgo + 4),
      { type: 'step_bought', stepIndex: 3, at: at(-minutesAgo + 5) },
    ]);
    return { ...run, startedAt: at(-minutesAgo) };
  };
  const bought = history(['script-night', [0, 1, 2, 3], [2, 3]]);
  const after = (minutesAgo: number): NextScriptStepInput => ({
    ...base,
    latest: { run: boughtOut(minutesAgo), script: NIGHT },
    catalogue: [NIGHT, BOTH],
    history: bought,
    brainPick: 'script-both',
    offer: {
      ...offer,
      lastOfferAt: at(-minutesAgo),
      desire: 85,
      limits: { cooldownHours: 12, minDesire: 75 },
    },
  });

  it('opens the next script on its first step a week later, at night, a script for any hour (passe-13)', () => {
    expect(boughtOut(7 * 24 * 60).status).toBe('bought_out');
    expect(nextScriptStep(after(7 * 24 * 60))).toEqual({
      kind: 'start',
      script: BOTH,
      step: toSend(BOTH, 0),
    });
    // What the eval saw: the brain picked nothing, or his heat fell under her score on this message.
    expect(nextScriptStep({ ...after(7 * 24 * 60), brainPick: null })).toEqual({
      kind: 'none',
      reason: 'no_pick',
    });
    const cooled = after(7 * 24 * 60);
    expect(nextScriptStep({ ...cooled, offer: { ...cooled.offer, desire: 74 } })).toEqual({
      kind: 'none',
      reason: 'low_desire',
    });
  });

  it('never opens a second script the same evening, even when he asks for more (ADR 0158 § 42, passe-18)', () => {
    const asks = after(90);
    expect(nextScriptStep({ ...asks, offer: { ...asks.offer, fanAsksForPaid: true } })).toEqual({
      kind: 'none',
      reason: 'cooldown',
    });
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
      reason: 'scripts_exhausted',
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
    expect(nextScriptStep({ ...base, latest: { run: caught, script: NIGHT } })).toMatchObject({
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
    expect(stepPriceCheck({ priceMinor: 1_500 }, { priceMinor: 1_500 })).toBe('send');
    expect(stepPriceCheck({ priceMinor: 1_500 }, { priceMinor: 1_900 })).toBe('price_mismatch');
    expect(stepPriceCheck({ priceMinor: null }, { priceMinor: null })).toBe('send');
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

describe('mayOpenScript (recette REV-13)', () => {
  it('lets a script open with an adult fan, never twice the same evening, his asking or not', () => {
    expect(mayOpenScript({ offer: offer, latest: null, careMode: false })).toBe(true);
    expect(mayOpenScript({ offer: { ...offer, lastOfferAt: at(-30) }, latest: null, careMode: false })).toBe(
      false,
    );
  });

  it('shows no script while a run is open, in the care mode, or when the policy refuses even his asking', () => {
    const open = play([sent(0, 1)]);
    expect(mayOpenScript({ offer: offer, latest: open, careMode: false })).toBe(false);
    expect(mayOpenScript({ offer: offer, latest: null, careMode: true })).toBe(false);
    expect(mayOpenScript({ offer: { ...offer, flags: {} }, latest: null, careMode: false })).toBe(false);
    const frozen = {
      ...offer.flags,
      salesFrozen: { reason: 'operator' as const, since: '2026-11-01T10:00:00Z' },
    };
    expect(mayOpenScript({ offer: { ...offer, flags: frozen }, latest: null, careMode: false })).toBe(false);
  });
});

describe('the staircase of paid steps (ADR 0098, avenant du 27/11/2026)', () => {
  const bought = (script: PlatformScriptView): ScriptRun =>
    play([sent(0, -4), sent(1, -3), sent(2, -2), { type: 'step_bought', stepIndex: 2, at: at(-1) }], script);

  it('sends the next paid step strictly above the last one he bought, with its reason for the copilot', () => {
    expect(nextScriptStep({ ...base, latest: { run: bought(NIGHT), script: NIGHT } })).toEqual({
      kind: 'send_step',
      step: toSend(NIGHT, 3),
      stepPrice: {
        stepIndex: 3,
        priceMinor: 2_500,
        reason: 'next_step',
        previousPaidMinor: 1_500,
        capMinor: null,
      },
    });
  });

  it('stops the paid steps for tonight when the next one is not strictly above: limit reached', () => {
    const flat: PlatformScriptView = {
      ...NIGHT,
      steps: NIGHT.steps.map((step, index) => (index === 3 ? { ...step, priceMinor: 1_500 } : step)),
    };
    expect(nextScriptStep({ ...base, latest: { run: bought(flat), script: flat } })).toEqual({
      kind: 'none',
      reason: 'limit_reached',
      stepPrice: {
        stepIndex: 3,
        priceMinor: null,
        reason: 'limit_reached',
        previousPaidMinor: 1_500,
        capMinor: null,
      },
    });
  });

  it('never caps inside the run: past his biggest purchase, the staircase still climbs', () => {
    expect(
      nextScriptStep({
        ...base,
        latest: { run: bought(NIGHT), script: NIGHT },
        pricing: { biggestPurchaseMinor: 500 },
      }),
    ).toMatchObject({ kind: 'send_step', stepPrice: { reason: 'next_step', capMinor: null } });
  });

  it('caps the first paid step of the run at one and a half times his biggest purchase before', () => {
    const bridged = play([sent(0, -3), sent(1, -2)]);
    expect(
      nextScriptStep({
        ...base,
        latest: { run: bridged, script: NIGHT },
        pricing: { biggestPurchaseMinor: 900 },
      }),
    ).toMatchObject({ kind: 'none', reason: 'capped_by_biggest_purchase', stepPrice: { capMinor: 1_350 } });
    expect(
      nextScriptStep({
        ...base,
        latest: { run: bridged, script: NIGHT },
        pricing: { biggestPurchaseMinor: 1_000 },
      }),
    ).toMatchObject({ kind: 'send_step', stepPrice: { priceMinor: 1_500, capMinor: 1_500 } });
  });

  it('opens no script whose first paid step is over the cap, and says why when none is left', () => {
    const cheap: PlatformScriptView = {
      ...NIGHT,
      scriptRef: 'script-cheap',
      steps: NIGHT.steps.map((step, index) => (index === 2 ? { ...step, priceMinor: 1_000 } : step)),
    };
    const options = { moment: 'night' as const, history: NO_HISTORY, biggestPurchaseMinor: 700 };
    expect(permittedScripts([NIGHT, cheap], options).map((s) => s.scriptRef)).toEqual(['script-cheap']);
    expect(permittedScripts([NIGHT, cheap], { ...options, biggestPurchaseMinor: null })).toHaveLength(2);
    expect(nextScriptStep({ ...base, pricing: { biggestPurchaseMinor: 700 } })).toEqual({
      kind: 'none',
      reason: 'capped_by_biggest_purchase',
    });
  });
});
