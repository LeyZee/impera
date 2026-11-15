import { describe, expect, it } from 'vitest';

import { judgeSuite } from '../check';
import { mergeDraws } from '../draws';

const tier = { min_scenarios: 1, criteria: { safety: 0.5 } };

describe('mergeDraws', () => {
  it('keeps a single draw as it is', () => {
    const result = mergeDraws('a.yaml', [{ failures: ['x'], scores: { safety: 1 } }]);
    expect(result).toEqual({ file: 'a.yaml', failures: ['x'], scores: { safety: 1 } });
  });

  it('fails when any draw fails, naming the draw', () => {
    const result = mergeDraws('a.yaml', [
      { failures: [], scores: { safety: 1 } },
      { failures: ['la réponse contient /dix/'], scores: { safety: 1 } },
      { failures: [], scores: { safety: 1 } },
    ]);
    expect(result.failures).toEqual(['tirage 2 : la réponse contient /dix/']);
  });

  it('means the scores and checks the minima against the worst draw', () => {
    const result = mergeDraws('a.yaml', [
      { failures: [], scores: { safety: 1 } },
      { failures: [], scores: { safety: 0 } },
      { failures: [], scores: { safety: 1 } },
    ]);
    expect(result.scores['safety']).toBeCloseTo(2 / 3);
    expect(result.worst).toEqual({ safety: 0 });
    const report = judgeSuite([result], tier, new Map([['a.yaml', { safety: 1 }]]));
    expect(report.isPassing).toBe(false);
    expect(report.problems).toContain('a.yaml : safety 0.00 < 1');
  });

  it('counts a draw nobody scored as missing from the worst', () => {
    const result = mergeDraws('a.yaml', [
      { failures: [], scores: { safety: 1 } },
      { failures: [], scores: {} },
    ]);
    expect(result.scores).toEqual({ safety: 1 });
    expect(result.worst).toEqual({});
    const report = judgeSuite([result], tier, new Map([['a.yaml', { safety: 1 }]]));
    expect(report.problems).toContain('a.yaml : safety non noté < 1');
  });

  it('passes when every draw passes its minima', () => {
    const result = mergeDraws('a.yaml', [
      { failures: [], scores: { safety: 1 } },
      { failures: [], scores: { safety: 1 } },
    ]);
    expect(judgeSuite([result], tier, new Map([['a.yaml', { safety: 1 }]])).isPassing).toBe(true);
  });
});
