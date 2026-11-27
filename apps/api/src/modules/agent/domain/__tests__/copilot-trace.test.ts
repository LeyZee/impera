import {
  CopilotTraceSchema,
  type CopilotSaleBlock,
  type SaleCondition,
  type SaleMomentVerdict,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { copilotTrace, type CopilotTraceInput, type EngineRefusal } from '../copilot-trace';
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
import type { OfferRefusal } from '../turn-sale';

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

/**
 * What the panel says for each refusal of the engine (audit 27/11): never « Bon moment » when the engine refuses, « Pas
 * encore » when the refusal lasts the evening or longer, « Bientôt » when it may lift within the session. Typed on every
 * refusal code: a new reason of the engine does not compile until the panel says it here.
 */
interface Said {
  /** « Quoi faire » when the brain wanted to offer: « Ne rien vendre » with the block, or a plain answer. */
  readonly move: 'no_sale' | 'reply';
  readonly block: CopilotSaleBlock | null;
  /** `null`: no moment to sell at all (a cut, or nothing may ever sell without her rhythm). */
  readonly verdict: SaleMomentVerdict | null;
  readonly condition?: SaleCondition;
}

/** The policy's and the gate's codes, and the composer's own: they reach the trace as the brain's offer refused. */
const OFFERED: Readonly<Record<OfferRefusal, Said>> = {
  // A cut: no moment at all, as before.
  do_not_contact: { move: 'no_sale', block: 'do_not_contact', verdict: null },
  risk: { move: 'no_sale', block: 'risk', verdict: null },
  sales_frozen: { move: 'no_sale', block: 'sales_frozen', verdict: null },
  // Until a human or he confirms it, which may happen in this conversation.
  age_unconfirmed: {
    move: 'no_sale',
    block: 'age_unconfirmed',
    verdict: 'soon',
    condition: 'age_unconfirmed',
  },
  // Until he comes back to paid content himself, or « à sec » until his pay: not tonight on her side.
  no_budget: { move: 'no_sale', block: 'no_budget', verdict: 'not_yet', condition: 'no_budget' },
  // `sameEvening`: at least her cooldown, never before her next day.
  cooldown: { move: 'no_sale', block: 'cooldown', verdict: 'not_yet', condition: 'cooldown' },
  // The pause after a purchase: 24 to 72 hours from his last purchase (48 by default).
  after_purchase: { move: 'no_sale', block: 'after_purchase', verdict: 'not_yet' },
  // His heat, within the session.
  low_desire: { move: 'no_sale', block: 'low_desire', verdict: 'soon', condition: 'desire_below_threshold' },
  desire_below_threshold: {
    move: 'no_sale',
    block: null,
    verdict: 'soon',
    condition: 'desire_below_threshold',
  },
  not_sexualizing: { move: 'no_sale', block: null, verdict: 'soon', condition: 'not_sexualizing' },
  availability_unconfirmed: {
    move: 'no_sale',
    block: null,
    verdict: 'soon',
    condition: 'availability_unconfirmed',
  },
  // Her persona sets no rhythm of scripts: nothing sells until it does.
  no_offer_context: { move: 'reply', block: null, verdict: null },
  // No step decided, for no reason the scripts give (a step waits, one goes): this message only.
  no_script_step: { move: 'reply', block: null, verdict: 'soon' },
  // ADR 0156 § 6: he came, nothing is sold that evening.
  he_came: { move: 'no_sale', block: 'he_came', verdict: 'not_yet' },
  // He left mid-script: she teases him first, then the script may go on.
  abandon_tease: { move: 'reply', block: null, verdict: 'soon' },
};

/** The scripts' own reasons for no step, read behind `no_script_step`. */
const SCRIPTED: Readonly<Record<Exclude<EngineRefusal, OfferRefusal>, Said>> = {
  // Something else answers this message (a custom order, an objection, a guard): this message only.
  held: { move: 'reply', block: null, verdict: 'soon' },
  // Until Reveal's history reads again, or the team changes her catalogue: nobody knows when.
  no_history: { move: 'reply', block: null, verdict: 'not_yet' },
  no_script: { move: 'reply', block: null, verdict: 'not_yet' },
  scripts_exhausted: { move: 'reply', block: null, verdict: 'not_yet' },
  price_mismatch: { move: 'reply', block: null, verdict: 'not_yet' },
  // Her pick only: the engine itself refuses nothing.
  no_pick: { move: 'reply', block: null, verdict: 'good' },
  // The hot session ended with his heat: it comes back within the session.
  cold_session: { move: 'no_sale', block: null, verdict: 'soon', condition: 'desire_below_threshold' },
  // A few messages of his after he bought a step, then the next one.
  in_tension: { move: 'reply', block: null, verdict: 'soon' },
};

/** Every refusal, once: it compiles only while both lists cover the engine's codes. */
const SAID: Readonly<Record<EngineRefusal, Said>> = { ...OFFERED, ...SCRIPTED };

const codesOf = <K extends string>(table: Readonly<Record<K, Said>>): K[] =>
  Object.keys(table).filter((key): key is K => key in table);

const gateOpen = { open: true } as const;

const offeredWith = (code: OfferRefusal): CopilotTraceInput => ({
  ...plain,
  offerRefused: code,
  scriptStart: gateOpen,
});

const scriptedWith = (code: Exclude<EngineRefusal, OfferRefusal>): CopilotTraceInput => ({
  ...plain,
  offerRefused: 'no_script_step',
  scripts: {
    decision: { kind: 'none', reason: code },
    script: null,
    moved: null,
    followed: null,
    opened: null,
    priceMismatch: null,
  },
  scriptStart: gateOpen,
});

function expectSaid(trace: ReturnType<typeof copilotTrace>, said: Said): void {
  expect(trace.move).toEqual({
    kind: said.move,
    priceMinor: null,
    block: said.move === 'no_sale' ? said.block : null,
  });
  expect(trace.saleMoment?.verdict ?? null).toBe(said.verdict);
  expect(trace.saleMoment?.conditions ?? []).toEqual(
    said.condition === undefined ? [] : [{ code: said.condition, met: false }],
  );
  // What is kept with the draft reads back through the contract.
  expect(CopilotTraceSchema.parse(trace)).toEqual(trace);
}

describe('the panel says what the engine decided, for every refusal (audit 27/11)', () => {
  for (const code of codesOf(OFFERED))
    it(`${code}, the brain's offer refused: « ${OFFERED[code].move} », ${String(OFFERED[code].verdict)}`, () => {
      expectSaid(copilotTrace(offeredWith(code)), SAID[code]);
    });

  for (const code of codesOf(SCRIPTED))
    it(`${code}, no step of her scripts: « ${SCRIPTED[code].move} », ${String(SCRIPTED[code].verdict)}`, () => {
      expectSaid(copilotTrace(scriptedWith(code)), SAID[code]);
    });

  it('in the pause after his purchase, the engine refuses a new script and the panel says it, offered or not', () => {
    const bought = new Date('2026-11-12T18:00:00Z');
    const scripts = scriptTurn({
      ...turnInput,
      offer: { ...offer, lastPurchaseAt: bought, limits: { ...offer.limits, afterPurchaseHours: 48 } },
    });
    expect(scripts.decision).toEqual({ kind: 'none', reason: 'after_purchase' });

    // She only chats: nothing to sell tonight, and why.
    const chatting = copilotTrace({ ...plain, scripts, scriptStart: gateOpen });
    expect(chatting.move).toEqual({ kind: 'no_sale', priceMinor: null, block: 'after_purchase' });
    expect(chatting.saleMoment).toEqual({ verdict: 'not_yet', conditions: [] });

    // The brain wanted to offer: refused the same way.
    const offering = copilotTrace({
      ...plain,
      scripts,
      offerRefused: 'no_script_step',
      scriptStart: gateOpen,
    });
    expect(offering.move).toEqual(chatting.move);
    expect(offering.saleMoment).toEqual(chatting.saleMoment);
  });

  it('the evening after a script, the cooldown is « pas encore » even when it is the only thing missing', () => {
    const scripts = scriptTurn({ ...turnInput, offer: { ...offer, lastOfferAt: BEFORE } });
    expect(scripts.decision).toEqual({ kind: 'none', reason: 'cooldown' });

    const trace = copilotTrace({ ...plain, scripts, scriptStart: gateOpen });
    expect(trace.move).toEqual({ kind: 'no_sale', priceMinor: null, block: 'cooldown' });
    expect(trace.saleMoment).toEqual({ verdict: 'not_yet', conditions: [{ code: 'cooldown', met: false }] });
  });

  it('a step waiting or the moment in her session stays « bientôt »', () => {
    const scripts = scriptTurn({ ...turnInput, latest: offered, history: history([0, 1]) });
    expect(copilotTrace({ ...plain, scripts, latest: offered }).saleMoment?.verdict).toBe('soon');
    expect(
      copilotTrace({ ...plain, scriptStart: { open: false, missing: ['not_sexualizing'] } }).saleMoment
        ?.verdict,
    ).toBe('soon');
  });
});
