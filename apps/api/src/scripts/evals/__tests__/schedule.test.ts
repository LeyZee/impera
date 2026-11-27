import { describe, expect, it } from 'vitest';

import {
  concurrencyOf,
  createWorstCase,
  DEFAULT_CONCURRENCY,
  PRIOR_TURN_EUR,
  runScheduled,
  type ScheduleOptions,
} from '../schedule';

/** A made-up conversation: how long it takes, what it spends when it ends, whether it throws. */
interface FakeJob {
  readonly name: string;
  readonly ms: number;
  readonly costEur?: number;
  readonly reserveEur?: number;
  readonly throws?: boolean;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Runs fake jobs and records what was in flight, the order they started and the order they were handed back. */
async function runFakes(
  jobs: readonly FakeJob[],
  options: Partial<Pick<ScheduleOptions<FakeJob, string>, 'concurrency' | 'capEur'>> & {
    readonly spentAtStart?: number;
  } = {},
): Promise<{
  readonly results: readonly string[];
  readonly ready: readonly string[];
  readonly started: readonly string[];
  readonly maxInFlight: number;
  readonly startedAgainst: ReadonlyMap<string, readonly string[]>;
  readonly isCapReached: boolean;
}> {
  let spent = options.spentAtStart ?? 0;
  let inFlight = new Set<string>();
  let maxInFlight = 0;
  const started: string[] = [];
  const ready: string[] = [];
  const startedAgainst = new Map<string, readonly string[]>();
  const outcome = await runScheduled<FakeJob, string>({
    jobs,
    concurrency: options.concurrency ?? 3,
    capEur: options.capEur ?? 100,
    spentEur: () => spent,
    reserveEur: (job) => job.reserveEur ?? 1,
    run: async (job) => {
      startedAgainst.set(job.name, [...inFlight]);
      inFlight = new Set([...inFlight, job.name]);
      maxInFlight = Math.max(maxInFlight, inFlight.size);
      started.push(job.name);
      try {
        await sleep(job.ms);
        spent += job.costEur ?? 0;
        if (job.throws === true) throw new Error(`${job.name} cassé`);
        return `${job.name} ok`;
      } finally {
        inFlight = new Set([...inFlight].filter((name) => name !== job.name));
      }
    },
    failed: (job, error) => `${job.name} KO ${error instanceof Error ? error.message : ''}`,
    onReady: (result) => ready.push(result),
  });
  return {
    results: outcome.results,
    ready,
    started,
    maxInFlight,
    startedAgainst,
    isCapReached: outcome.isCapReached,
  };
}

describe('runScheduled', () => {
  it('never runs more jobs at once than the concurrency', async () => {
    const jobs = Array.from({ length: 10 }, (_, index) => ({
      name: `c${String(index)}`,
      ms: 2 + (index % 3),
    }));
    const run = await runFakes(jobs, { concurrency: 3 });
    expect(run.maxInFlight).toBe(3);
    expect(run.results).toHaveLength(10);
  });

  it('runs one after the other at 1', async () => {
    const jobs = [
      { name: 'a', ms: 5 },
      { name: 'b', ms: 1 },
      { name: 'c', ms: 3 },
    ];
    const run = await runFakes(jobs, { concurrency: 1 });
    expect(run.maxInFlight).toBe(1);
    expect(run.started).toEqual(['a', 'b', 'c']);
  });

  it('hands results back in the jobs’ order, whatever order they finish in', async () => {
    const jobs = [
      { name: 'a', ms: 15 },
      { name: 'b', ms: 1 },
      { name: 'c', ms: 8 },
      { name: 'd', ms: 1 },
    ];
    const run = await runFakes(jobs, { concurrency: 4 });
    expect(run.ready).toEqual(['a ok', 'b ok', 'c ok', 'd ok']);
    expect(run.results).toEqual(run.ready);
  });

  it('lets a failing job fail alone, the others played', async () => {
    const jobs = [
      { name: 'a', ms: 5 },
      { name: 'b', ms: 1, throws: true },
      { name: 'c', ms: 2 },
      { name: 'd', ms: 1 },
    ];
    const run = await runFakes(jobs, { concurrency: 2 });
    expect(run.results).toEqual(['a ok', 'b KO b cassé', 'c ok', 'd ok']);
    expect(run.isCapReached).toBe(false);
  });

  it('starts nothing once the cap is reached and nothing is in flight', async () => {
    const run = await runFakes([{ name: 'a', ms: 1 }], { capEur: 6, spentAtStart: 6 });
    expect(run.results).toEqual([]);
    expect(run.isCapReached).toBe(true);
  });

  it('starts a job alone while under the cap, whatever its worst case, as one after the other did', async () => {
    const run = await runFakes([{ name: 'a', ms: 1, reserveEur: 50 }], { capEur: 6, spentAtStart: 5.9 });
    expect(run.results).toEqual(['a ok']);
  });

  it('never joins jobs in flight when their worst cases and its own could pass the cap', async () => {
    // 2 spent, 2 held by each: a and b fit (2 + 2 + 2), c would make 8 against 6 and waits for one to end.
    const jobs = [
      { name: 'a', ms: 5, reserveEur: 2 },
      { name: 'b', ms: 30, reserveEur: 2 },
      { name: 'c', ms: 1, reserveEur: 2 },
    ];
    const run = await runFakes(jobs, { concurrency: 3, capEur: 6, spentAtStart: 2 });
    expect(run.startedAgainst.get('b')).toEqual(['a']);
    expect(run.startedAgainst.get('c')).toEqual(['b']);
    expect(run.results).toEqual(['a ok', 'b ok', 'c ok']);
    expect(run.isCapReached).toBe(false);
  });

  it('stops the pass when what the jobs spent reaches the cap, the jobs left not started', async () => {
    const jobs = [
      { name: 'a', ms: 3, costEur: 2, reserveEur: 2 },
      { name: 'b', ms: 3, costEur: 2, reserveEur: 2 },
      { name: 'c', ms: 3, costEur: 2, reserveEur: 2 },
      { name: 'd', ms: 1, costEur: 2, reserveEur: 2 },
    ];
    const run = await runFakes(jobs, { concurrency: 4, capEur: 6 });
    // Held at their worst, never more than 6 € in flight: a, b, c; then 6 € spent, d never starts.
    expect(run.started).toEqual(['a', 'b', 'c']);
    expect(run.results).toEqual(['a ok', 'b ok', 'c ok']);
    expect(run.isCapReached).toBe(true);
  });
});

describe('concurrencyOf', () => {
  it('takes the flag, else the environment, else the default', () => {
    expect(concurrencyOf('2', '6')).toBe(2);
    expect(concurrencyOf(undefined, '6')).toBe(6);
    expect(concurrencyOf(undefined, undefined)).toBe(DEFAULT_CONCURRENCY);
    expect(concurrencyOf(undefined, '')).toBe(DEFAULT_CONCURRENCY);
  });

  it('refuses what is no number from 1 to 8', () => {
    for (const given of ['0', '9', '2.5', 'quatre', '-1'])
      expect(concurrencyOf(given, undefined)).toBeUndefined();
  });
});

describe('createWorstCase', () => {
  it('holds each turn at the prior until a dearer one is measured, never below it', () => {
    const worst = createWorstCase();
    expect(worst.reserveEur(3)).toBeCloseTo(3 * PRIOR_TURN_EUR);
    worst.observe(0.01, 2);
    expect(worst.reserveEur(3)).toBeCloseTo(3 * PRIOR_TURN_EUR);
    worst.observe(0.9, 3);
    expect(worst.reserveEur(2)).toBeCloseTo(0.6);
    worst.observe(0, 0);
    expect(worst.reserveEur(2)).toBeCloseTo(0.6);
  });
});
