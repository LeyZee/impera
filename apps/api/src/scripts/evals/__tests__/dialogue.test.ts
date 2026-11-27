import { describe, expect, it } from 'vitest';

import { UNKNOWN_AVAILABILITY, type ComposedTurn } from '../../../modules/agent/index';
import { afterTurn, beforeTurn, type DialogueState } from '../dialogue';
import { readScenario } from '../scenario';
import { scriptsInputOf } from '../scripts-input';

const NOW = new Date('2026-11-06T20:00:00Z');

const SCENARIO = readScenario(`
description: une conversation fictive rejouée
persona_version: demo
scripts:
  catalogue:
    - ref: soiree-demo
      description: un script fictif
      steps:
        - { kind: free, media: une photo }
        - { kind: paid, price_euros: 15, instruction: la suite }
  run: { script: soiree-demo, steps: [{ index: 0, outcome: sent }, { index: 1, outcome: sent }] }
  history: [{ script: soiree-demo, sent: [0, 1] }]
inbound: coucou
expect: {}
then:
  - { after_minutes: 600, event: buys_step, inbound: je l'ai pris, expect: { voice: { bubbles_max: 2 } } }
  - inbound: [bonne nuit, à demain]
`);

const start = (): DialogueState => {
  if (SCENARIO.scripts === undefined) throw new Error('no scripts');
  return {
    now: NOW,
    history: [],
    desire: 40,
    availability: UNKNOWN_AVAILABILITY,
    scripts: scriptsInputOf(SCENARIO.scripts, NOW),
  };
};

describe('a whole conversation replayed without a keyboard (passes de test du 20/11)', () => {
  it('reads the turns after the first: time, what Reveal says meanwhile, his lines, what her answer must show', () => {
    expect(SCENARIO.then).toEqual([
      {
        after_minutes: 600,
        event: 'buys_step',
        inbound: "je l'ai pris",
        expect: { voice: { bubbles_max: 2 } },
      },
      { after_minutes: 2, inbound: ['bonne nuit', 'à demain'], expect: {} },
    ]);
    expect(readScenario('description: d\npersona_version: demo\ninbound: x\nexpect: {}\n').then).toEqual([]);
  });

  it('keeps her answer, his score and his availability as the job stores them', () => {
    const record = {
      ...UNKNOWN_AVAILABILITY,
      state: 'no' as const,
      signal: 'leaving_soon' as const,
      at: NOW,
    };
    const desire: ComposedTurn['desireRead'] = { before: 40, score: 62, signals: [], weightsVersion: 'v' };
    const heard = [{ from: 'fan' as const, text: 'je file', at: NOW }];
    const next = afterTurn(start(), {
      heard,
      bubbles: ['À plus tard toi 🌙'],
      desire,
      availability: { record, changed: true },
      scripts: undefined,
    });
    expect(next.history).toEqual([...heard, { from: 'creator', text: 'À plus tard toi 🌙', at: NOW }]);
    expect(next.desire).toBe(62);
    expect(next.availability).toBe(record);

    // Nothing went out (a human, a guard): his message stays, nothing of hers, his score as before.
    const held = afterTurn(start(), {
      heard,
      bubbles: [],
      desire: undefined,
      availability: undefined,
      scripts: undefined,
    });
    expect(held.history).toEqual(heard);
    expect(held.desire).toBe(40);
  });

  it('keeps the reason she gave him about meeting her, and her one tease, only once her answer went out', () => {
    const left = { heard: [], desire: undefined, availability: undefined, scripts: undefined };
    const gave = afterTurn(start(), {
      ...left,
      bubbles: ['Pas si vite toi'],
      meetingAnswer: { kind: 'reason', reason: 'too_early' },
    });
    expect(gave.meeting).toEqual({ given: ['too_early'], teased: false });
    const teased = afterTurn(gave, {
      ...left,
      bubbles: ['Tu lâches rien hein'],
      meetingAnswer: { kind: 'tease' },
    });
    expect(teased.meeting).toEqual({ given: ['too_early'], teased: true });
    // Held by a guard or a human: nothing was said to him, nothing is kept.
    const held = afterTurn(start(), {
      ...left,
      bubbles: [],
      meetingAnswer: { kind: 'reason', reason: 'too_early' },
    });
    expect(held.meeting).toBeUndefined();
  });

  it('moves the clock and marks the last paid step bought when Reveal says he bought it, never otherwise', () => {
    const later = beforeTurn(start(), 600, 'buys_step');
    expect(later.now).toEqual(new Date(NOW.getTime() + 600 * 60_000));
    expect(later.scripts?.history?.scripts).toEqual([
      { scriptRef: 'soiree-demo', sentStepIndexes: [0, 1], boughtStepIndexes: [1] },
    ]);
    expect(beforeTurn(start(), 5, undefined).scripts?.history?.scripts[0]?.boughtStepIndexes).toEqual([]);
  });
});
