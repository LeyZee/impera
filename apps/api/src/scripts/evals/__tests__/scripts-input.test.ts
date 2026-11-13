import { describe, expect, it } from 'vitest';

import { readScenario } from '../scenario';
import { scriptsInputOf } from '../scripts-input';

const NOW = new Date('2026-11-12T22:00:00Z');

describe('her scripts in an eval scenario (ADR 0098)', () => {
  it('reads the made-up catalogue in cents, his run with the catalogue’s kinds and prices, and Reveal’s history', () => {
    const { scripts } = readScenario(`
description: un déroulé fictif
persona_version: demo
scripts:
  catalogue:
    - ref: soiree-demo
      moment: night
      description: un script fictif
      steps:
        - { kind: free, media: une photo }
        - { kind: paid, price_euros: 12.5, instruction: la suite }
  run: { script: soiree-demo, steps: [{ index: 0, outcome: sent }, { index: 1, outcome: sent }], ignored_messages: 1 }
  history: [{ script: soiree-demo, sent: [0, 1], bought: [1] }]
inbound: encore
expect: {}
`);
    if (scripts === undefined) throw new Error('no scripts');
    const input = scriptsInputOf(scripts, NOW);

    expect(input.catalogue[0]?.steps).toEqual([
      { kind: 'free', priceMinor: null, mediaSheet: 'une photo', mediaRefs: [] },
      { kind: 'paid', priceMinor: 1_250, instruction: 'la suite', mediaRefs: [] },
    ]);
    expect(input.latest?.steps.map((step) => [step.stepIndex, step.kind, step.priceMinor])).toEqual([
      [0, 'free', null],
      [1, 'paid', 1_250],
    ]);
    expect(input.latest).toMatchObject({ status: 'open', ignoredMessages: 1, endedAt: null });
    expect(input.history?.scripts).toEqual([
      { scriptRef: 'soiree-demo', sentStepIndexes: [0, 1], boughtStepIndexes: [1] },
    ]);
  });
});
