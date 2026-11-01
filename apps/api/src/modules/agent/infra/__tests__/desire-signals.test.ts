import { DESIRE_BRAIN_SIGNALS, DESIRE_SIGNALS } from '@nirvana/contracts';
import { BriefSchema } from '@nirvana/llm';
import { describe, expect, it } from 'vitest';

import { desireScore, NO_MEASURE, type DesireTurn } from '../../domain/desire';

const NOW = new Date('2026-10-27T21:00:00Z');

/** Every code the score can journal is in the closed list of the contracts, so every screen has its label (P3-12). */
describe('desire signals', () => {
  it('emits only codes of DESIRE_SIGNALS, whatever the brief says and code measures', () => {
    const base: DesireTurn = {
      previous: { score: 50, at: NOW },
      signals: [...DESIRE_BRAIN_SIGNALS],
      intent: 'small_talk',
      sentiment: 'neutral',
      measured: NO_MEASURE,
      risks: [],
      ageDisputed: false,
      now: NOW,
    };
    const measures = [
      { lengthRatio: 3, replySeconds: 10, suggestiveEmojis: 9, inARow: 4 },
      { lengthRatio: 0.1, replySeconds: 9_000, suggestiveEmojis: 0, inARow: 1 },
    ];
    const turns: DesireTurn[] = [
      ...BriefSchema.shape.intent.options.flatMap((intent) =>
        BriefSchema.shape.sentiment.options.flatMap((sentiment) =>
          measures.map((measured) => ({ ...base, intent, sentiment, measured })),
        ),
      ),
      ...BriefSchema.shape.risks.element.options.map((risk) => ({ ...base, risks: [risk] })),
      { ...base, ageDisputed: true },
    ];
    const emitted: readonly string[] = [...new Set(turns.flatMap((turn) => desireScore(turn).signals))];
    const known: readonly string[] = DESIRE_SIGNALS;
    expect(emitted.filter((signal) => !known.includes(signal))).toEqual([]);
    expect(known.filter((signal) => !emitted.includes(signal))).toEqual([]);
  });
});
