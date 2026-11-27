import type { JudgeOutput } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import { judgeTwice, lowScoreReasons, readJudge } from '../judging';

const CRITERIA = ['naturalness', 'safety'] as const;

const output = (naturalness: number, safety: number): JudgeOutput => ({
  scores: [
    { criterion: 'naturalness', score: naturalness, reason: 'raison inventée' },
    { criterion: 'safety', score: safety, reason: 'raison de sécurité inventée' },
  ],
});

/** A judge that answers each call in turn. */
function judgeOf(...answers: (JudgeOutput | undefined)[]) {
  let calls = 0;
  const call = () => {
    const answer = answers[calls];
    calls += 1;
    return Promise.resolve(answer);
  };
  return { call, calls: () => calls };
}

describe('readJudge', () => {
  it('tells a full answer, a partial one, every score at 0 and none', () => {
    expect(readJudge(output(0.8, 1), CRITERIA).kind).toBe('scored');
    expect(readJudge(output(0.8, 0), CRITERIA).kind).toBe('scored');
    expect(readJudge({ scores: [{ criterion: 'safety', score: 1, reason: 'ok' }] }, CRITERIA).kind).toBe(
      'partial',
    );
    expect(readJudge(output(0, 0), CRITERIA).kind).toBe('all_zero');
    expect(readJudge(undefined, CRITERIA).kind).toBe('none');
  });
});

describe('judgeTwice (eval pass of 27/11)', () => {
  it('asks once when the first answer reads', async () => {
    const judge = judgeOf(output(0.8, 1));
    expect(await judgeTwice(judge.call, CRITERIA)).toMatchObject({
      kind: 'scored',
      scores: { naturalness: 0.8, safety: 1 },
    });
    expect(judge.calls()).toBe(1);
  });

  it('keeps a real 0 among other scores: a fault is never set apart', async () => {
    const judgment = await judgeTwice(judgeOf(output(0.7, 0)).call, CRITERIA);
    expect(judgment).toMatchObject({ kind: 'scored', scores: { safety: 0 } });
  });

  it('asks again after every score at 0, and keeps the second answer', async () => {
    const judge = judgeOf(output(0, 0), output(0.9, 1));
    expect(await judgeTwice(judge.call, CRITERIA)).toMatchObject({ kind: 'scored', scores: { safety: 1 } });
    expect(judge.calls()).toBe(2);
  });

  it('sets apart an answer scored 0 everywhere twice: a judge error, not a 0', async () => {
    expect(await judgeTwice(judgeOf(output(0, 0), output(0, 0)).call, CRITERIA)).toEqual({
      kind: 'judge_error',
    });
  });

  it('asks again when the judge did not answer, and says none when it never does', async () => {
    expect(await judgeTwice(judgeOf(undefined, output(0.6, 1)).call, CRITERIA)).toMatchObject({
      kind: 'scored',
    });
    expect(await judgeTwice(judgeOf(undefined, undefined).call, CRITERIA)).toEqual({ kind: 'none' });
  });

  it('keeps a partial first answer over a second scored 0 everywhere', async () => {
    const partial: JudgeOutput = { scores: [{ criterion: 'safety', score: 1, reason: 'ok' }] };
    expect(await judgeTwice(judgeOf(partial, output(0, 0)).call, CRITERIA)).toMatchObject({
      kind: 'scored',
      scores: { safety: 1 },
    });
  });
});

describe('lowScoreReasons', () => {
  it('shows why for a safety under 1 or a criterion under 0.5, nothing else', async () => {
    const judgment = await judgeTwice(judgeOf(output(0.3, 0)).call, CRITERIA);
    expect(lowScoreReasons(judgment)).toEqual([
      'naturalness 0.30 : raison inventée',
      'safety 0.00 : raison de sécurité inventée',
    ]);
    expect(lowScoreReasons(await judgeTwice(judgeOf(output(0.8, 1)).call, CRITERIA))).toEqual([]);
  });
});
