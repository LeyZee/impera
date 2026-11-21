import { CopilotAssistSchema, OBJECTION_KIND_LABELS, type CopilotTrace } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { copilotAssist, copilotCuts, type CopilotLive } from '../copilot-assist';

const NOW = new Date('2026-11-21T15:00:00Z');
const DAY_MS = 86_400_000;

/** A made-up trace (ADR 0010): the paid step 2 of a script at 15 €, offered with this draft. */
const TRACE: CopilotTrace = {
  move: { kind: 'offer_step', priceMinor: 1_500, block: null },
  reasons: ['rewritten_once'],
  sale: {
    scriptRef: 'script-demo',
    scriptName: 'Soirée de démonstration',
    stepIndex: 1,
    stepCount: 3,
    nextStep: { stepIndex: 1, priceMinor: 1_500 },
    refusedStepIndexes: [],
    offerPending: true,
  },
  saleMoment: { verdict: 'good', conditions: [] },
  desireTrend: 'up',
};

const LIVE: CopilotLive = {
  trace: TRACE,
  flags: { ageConfirmedAt: '2026-10-01T10:00:00Z' },
  careSince: null,
  careClosedAt: null,
  held: false,
  usedObjections: ['too_expensive', 'too_expensive'],
  customOrderOpen: false,
  followUpDue: false,
};

describe('the copilot’s lines beside the draft (ADR 0141 lot a)', () => {
  it('with a draft: the gesture and its price from the code, the why, the sale and the moment', () => {
    const assist = copilotAssist(LIVE, NOW, true);

    expect(assist.nextMove).toEqual({
      kind: 'offer_step',
      label: 'Proposer Étape 2 à 15 €',
      priceMinor: 1_500,
      block: null,
    });
    expect(assist.reasons).toEqual([{ code: 'rewritten_once', label: 'Réécrit une fois par une garde' }]);
    expect(assist.sale).toEqual({
      script: { name: 'Soirée de démonstration', stepIndex: 1, stepCount: 3, stepName: 'Étape 2' },
      nextStep: { name: 'Étape 2', priceMinor: 1_500 },
      refusedSteps: [],
      usedObjections: [OBJECTION_KIND_LABELS.too_expensive],
      customOrderOpen: false,
      offerPending: true,
    });
    expect(assist.signals).toEqual({ desireTrend: 'up', followUpDue: false });
    expect(assist.saleMoment).toEqual({ verdict: 'good', conditions: [] });
    expect(assist.cuts).toEqual([]);
    // Lot b is not there yet: no button, no click.
    expect(assist.buttons).toEqual([]);
    expect(CopilotAssistSchema.parse(assist)).toEqual(assist);
  });

  it('says why nothing is sold with the code’s own label', () => {
    const trace: CopilotTrace = { ...TRACE, move: { kind: 'no_sale', priceMinor: null, block: 'cooldown' } };
    expect(copilotAssist({ ...LIVE, trace }, NOW, true).nextMove).toEqual({
      kind: 'no_sale',
      label: 'Ne rien vendre',
      priceMinor: null,
      block: 'cooldown',
      blockLabel: 'Offre trop récente',
    });
  });

  it('without a draft: where the sale stands and the signals, never an older draft’s gesture or moment', () => {
    const assist = copilotAssist({ ...LIVE, followUpDue: true }, NOW, false);

    expect(assist.nextMove).toBeNull();
    expect(assist.reasons).toEqual([]);
    expect(assist.sale?.script?.name).toBe('Soirée de démonstration');
    expect(assist.signals.followUpDue).toBe(true);
    expect(assist.saleMoment).toBeUndefined();
    expect(CopilotAssistSchema.parse(assist)).toEqual(assist);
  });

  it('a conversation a human holds: hand over, and why', () => {
    const assist = copilotAssist({ ...LIVE, held: true }, NOW, false);

    expect(assist.nextMove?.kind).toBe('hand_over');
    expect(assist.reasons.map((reason) => reason.code)).toEqual(['handoff']);
  });

  it('a cut removes the gesture, the sale, the moment and the buttons, and only says the cut', () => {
    const doubt = copilotAssist(
      { ...LIVE, flags: { ageDisputed: { since: '2026-11-21T14:00:00Z', by: 'policy' } } },
      NOW,
      true,
    );

    expect(doubt).toEqual({
      nextMove: null,
      reasons: [],
      sale: null,
      signals: { desireTrend: null, followUpDue: false },
      cuts: ['age_doubt'],
      buttons: [],
      clicksLeftToday: 0,
      saleMoment: null,
    });
    expect(CopilotAssistSchema.parse(doubt)).toEqual(doubt);
  });

  it('cuts on his limits as they are now, failing closed when they do not read', () => {
    const cutsOf = (live: Partial<CopilotLive>) => copilotCuts({ ...LIVE, ...live }, NOW);

    expect(cutsOf({})).toEqual([]);
    expect(cutsOf({ careSince: NOW })).toEqual(['care']);
    expect(cutsOf({ careClosedAt: new Date(NOW.getTime() - 29 * DAY_MS) })).toEqual(['care_exit']);
    expect(cutsOf({ careClosedAt: new Date(NOW.getTime() - 31 * DAY_MS) })).toEqual([]);
    expect(cutsOf({ flags: { doNotContact: true } })).toEqual(['do_not_contact']);
    expect(cutsOf({ flags: { salesFrozen: { reason: 'operator', since: '2026-11-20T10:00:00Z' } } })).toEqual(
      ['sales_frozen'],
    );
    expect(cutsOf({ flags: null })).toEqual(['limits_unread']);
  });
});
