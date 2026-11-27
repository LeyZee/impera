import { z } from 'zod';

/**
 * How many conversations an eval pass plays at once by default. Four cut a 37-conversation smoke pass from about
 * two and a half hours to under an hour, while the voice and the judge keep few requests in flight each (their
 * rate limits are retried, not failed). 1 is the pass one conversation after the other, as before 27/11.
 */
export const DEFAULT_CONCURRENCY = 4;
const MAX_CONCURRENCY = 8;

const ConcurrencySchema = z.coerce.number().int().min(1).max(MAX_CONCURRENCY);

/** `--concurrency`, else `EVALS_CONCURRENCY`, else the default; `undefined` when what was given is no such number. */
export function concurrencyOf(flag: string | undefined, env: string | undefined): number | undefined {
  const given = flag ?? (env === '' ? undefined : env);
  if (given === undefined) return DEFAULT_CONCURRENCY;
  const parsed = ConcurrencySchema.safeParse(given);
  return parsed.success ? parsed.data : undefined;
}

export const CONCURRENCY_HELP = `un nombre de 1 à ${String(MAX_CONCURRENCY)}`;

export interface ScheduleOptions<J, R> {
  /** In the order the report gives them. */
  readonly jobs: readonly J[];
  readonly concurrency: number;
  /** The pass's cap and what it spent so far, in euros. */
  readonly capEur: number;
  readonly spentEur: () => number;
  /** What a job may cost at worst, in euros: held while it runs. */
  readonly reserveEur: (job: J) => number;
  readonly run: (job: J) => Promise<R>;
  /** What a job that threw stands for: it fails alone, the others go on. */
  readonly failed: (job: J, error: unknown) => R;
  /** Called once per job that ran, in the jobs' order whatever order they finish in. */
  readonly onReady: (result: R, job: J) => void;
}

export interface ScheduleOutcome<R> {
  /** The jobs that ran, in the jobs' order: always the first ones, none skipped. */
  readonly results: readonly R[];
  /** True when the cap stopped the pass before its last job. */
  readonly isCapReached: boolean;
}

/**
 * Runs the jobs `concurrency` at a time, started in their order, and hands their results back in that order.
 *
 * The cap: a job alone starts as long as the pass is under its cap, as the one-at-a-time pass did (each call is
 * then refused by the gateway once the cap is reached). A job joins others in flight only if what was spent, plus
 * the worst case of every job in flight and of its own, stays within the cap; otherwise it waits for one to finish
 * and is asked again. So running several at once never takes a pass further past its cap than the one-at-a-time
 * pass would. When nothing is in flight and the cap is reached, the pass stops: the jobs left do not run.
 */
export async function runScheduled<J, R>(options: ScheduleOptions<J, R>): Promise<ScheduleOutcome<R>> {
  const { jobs, concurrency, capEur, spentEur, reserveEur } = options;
  const settled = new Map<number, R>();
  const results: R[] = [];
  const inFlight = new Map<number, { readonly reserve: number; readonly done: Promise<void> }>();
  let next = 0;
  let isCapReached = false;

  const release = (): void => {
    // The longest finished prefix goes out, so the report reads as the one-at-a-time pass wrote it.
    for (;;) {
      const index = results.length;
      const result = settled.get(index);
      const job = jobs[index];
      if (result === undefined || job === undefined) return;
      settled.delete(index);
      results.push(result);
      options.onReady(result, job);
    }
  };

  const mayStart = (job: J): boolean => {
    const spent = spentEur();
    if (inFlight.size === 0) return spent < capEur;
    const held = [...inFlight.values()].reduce((sum, flight) => sum + flight.reserve, 0);
    return spent + held + reserveEur(job) <= capEur;
  };

  const start = (index: number, job: J): void => {
    const done = (async (): Promise<void> => {
      let result: R;
      try {
        result = await options.run(job);
      } catch (error) {
        result = options.failed(job, error);
      }
      settled.set(index, result);
      inFlight.delete(index);
      release();
    })();
    inFlight.set(index, { reserve: reserveEur(job), done });
  };

  for (;;) {
    const job = jobs[next];
    if (job === undefined) break;
    if (inFlight.size < concurrency && mayStart(job)) {
      start(next, job);
      next += 1;
      continue;
    }
    if (inFlight.size === 0) {
      isCapReached = true;
      break;
    }
    await Promise.race([...inFlight.values()].map((flight) => flight.done));
  }
  await Promise.all([...inFlight.values()].map((flight) => flight.done));
  return { results, isCapReached };
}

/**
 * What one turn of one draw (his message, her answer, the judge) is held at before any was measured: about seven
 * times a measured smoke turn (3,40 USD for 37 scenarios of 3 draws, 1 to 3 turns each, 12/11).
 */
export const PRIOR_TURN_EUR = 0.1;

/** A conversation's worst case, from the dearest turn seen so far in the pass, never below the prior. */
export interface WorstCase {
  reserveEur(turns: number): number;
  /** What a finished conversation cost, for the turns it played. */
  observe(costEur: number, turns: number): void;
}

export function createWorstCase(priorTurnEur = PRIOR_TURN_EUR): WorstCase {
  let perTurn = priorTurnEur;
  return {
    reserveEur: (turns) => turns * perTurn,
    observe(costEur, turns) {
      if (turns > 0) perTurn = Math.max(perTurn, costEur / turns);
    },
  };
}
