import type { JudgeOutput } from '@impera/llm';
import { describe, expect, it } from 'vitest';

import {
  judgeErrorLimitText,
  judgeErrorProblem,
  JudgeErrorLimitSchema,
  judgeTwice,
  lowScoreReasons,
  readJudge,
} from '../judging';

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

describe('judgeErrorProblem (relecture Bilan de #1083)', () => {
  const count = { max_count: 2 };
  const share = { max_share: 0.1 };

  it('passes under and at the limit, fails past it, by count', () => {
    expect(judgeErrorProblem(1, 90, count)).toBeUndefined();
    expect(judgeErrorProblem(2, 90, count)).toBeUndefined();
    expect(judgeErrorProblem(3, 90, count)).toContain('3 tour(s) jugé(s) sur 90');
  });

  it('passes under and at the limit, fails past it, by share of the judged turns', () => {
    expect(judgeErrorProblem(9, 100, share)).toBeUndefined();
    expect(judgeErrorProblem(10, 100, share)).toBeUndefined();
    expect(judgeErrorProblem(11, 100, share)).toContain('10 % des tours jugés au plus');
  });

  it('fails a broken judge that set every turn apart', () => {
    expect(judgeErrorProblem(40, 40, share)).toBeDefined();
    expect(judgeErrorProblem(40, 40, count)).toBeDefined();
  });

  it('holds both limits when both are given', () => {
    const both = { max_count: 5, max_share: 0.1 };
    expect(judgeErrorProblem(3, 20, both)).toBeDefined();
    expect(judgeErrorProblem(6, 100, both)).toBeDefined();
    expect(judgeErrorProblem(2, 100, both)).toBeUndefined();
  });

  it('reads no error when no turn was judged', () => {
    expect(judgeErrorProblem(0, 0, share)).toBeUndefined();
    expect(judgeErrorProblem(0, 0, count)).toBeUndefined();
  });

  it('says the limit in words, and asks for at least one bound in the file', () => {
    expect(judgeErrorLimitText({ max_count: 2, max_share: 0.1 })).toBe(
      '2 au plus, 10 % des tours jugés au plus',
    );
    expect(JudgeErrorLimitSchema.safeParse({}).success).toBe(false);
    expect(JudgeErrorLimitSchema.safeParse({ max_share: 1.5 }).success).toBe(false);
    expect(JudgeErrorLimitSchema.safeParse({ max_count: 2, other: 1 }).success).toBe(false);
  });
});
