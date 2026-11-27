import { describe, expect, it } from 'vitest';

import { CopilotTraceSchema, copilotEuros, copilotNextMove, copilotStepName } from './copilot-trace';

const TRACE = {
  move: { kind: 'reply', priceMinor: null, block: null },
  reasons: [],
  sale: null,
  saleMoment: null,
  desireTrend: null,
};

describe('the copilot’s trace kept with a draft (ADR 0141 lot a)', () => {
  it('keeps codes and numbers only: a text, a figure of desire or an unknown code does not read', () => {
    expect(CopilotTraceSchema.safeParse(TRACE).success).toBe(true);
    for (const broken of [
      { ...TRACE, label: 'Répondre' },
      { ...TRACE, move: { ...TRACE.move, kind: 'discount' } },
      { ...TRACE, reasons: ['prompt'] },
      { ...TRACE, desireTrend: 72 },
      { ...TRACE, desire: 72 },
    ])
      expect(CopilotTraceSchema.safeParse(broken).success).toBe(false);
  });

  it('words the gesture from the closed lists, the price from the code', () => {
    expect(copilotNextMove({ kind: 'offer_step', priceMinor: 1_250, block: null }, 2)).toEqual({
      kind: 'offer_step',
      label: 'Proposer Étape 3 à 12,50 €',
      priceMinor: 1_250,
      block: null,
    });
    expect(copilotNextMove({ kind: 'no_sale', priceMinor: null, block: 'low_desire' }, null)).toMatchObject({
      label: 'Ne rien vendre',
      blockLabel: 'Désir encore trop bas',
    });
    expect(copilotNextMove({ kind: 'reply', priceMinor: 900, block: 'risk' }, null)).toEqual({
      kind: 'reply',
      label: 'Répondre',
      priceMinor: null,
      block: null,
    });
    expect(copilotStepName(0)).toBe('Étape 1');
    expect(copilotEuros(1_500)).toBe('15 €');
    expect(copilotEuros(905)).toBe('9,05 €');
  });
});
