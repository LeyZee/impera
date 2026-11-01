import { DomainError, nextPayPeriod, type PayPeriod } from '@nirvana/contracts';

import { blockReasonOf } from '../domain/period-blocks';
import type { JobLogger, OpenPeriodFacts, PayrollJobStore, PeriodDecision } from '../domain/ports';
import { firstOpenPeriod, planPeriod, type PeriodSnapshot } from '../domain/recalculation';

/** What one period's recalculation did, for the job's log line. */
export interface RecalculationOutcome {
  readonly period: PayPeriod;
  readonly outcome: 'written' | 'unchanged' | 'never' | 'blocked';
  readonly written: number;
}

/**
 * The plan, or the business reason the period cannot be computed yet: the job says it, the period records it for the
 * team to see (recette du 28/10, Équipe G1), and the job tries again later.
 */
function decide(snapshot: PeriodSnapshot): PeriodDecision {
  try {
    return planPeriod(snapshot);
  } catch (error) {
    if (error instanceof DomainError) return { kind: 'blocked', error, reason: blockReasonOf(error) };
    throw error;
  }
}

/**
 * The periods the hourly run computes: from the team's first open period (before any closing, the earliest period a
 * validated report waits in) up to the current one.
 */
export function periodsToRecompute(facts: OpenPeriodFacts): PayPeriod[] {
  const earliest =
    facts.earliestUncounted !== null && facts.earliestUncounted < facts.current
      ? facts.earliestUncounted
      : facts.current;
  const periods: PayPeriod[] = [];
  for (let period = firstOpenPeriod(facts.lastClosed) ?? earliest; period <= facts.current;) {
    periods.push(period);
    period = nextPayPeriod(period);
  }
  return periods;
}

/** `payroll.recalculate` and `payroll.recalculate_open` (EQ-04, ADR 0032). */
export interface Recalculation {
  /** The drafts of `period`, then, when it is closed, those of the team's first open period, where late reports go. */
  recalculate(period: PayPeriod): Promise<RecalculationOutcome[]>;
  /** Every open period up to the current one, the hour's safety net. */
  recalculateOpen(): Promise<RecalculationOutcome[]>;
}

export function createRecalculation(
  store: PayrollJobStore,
  logger: JobLogger,
  now: () => Date,
): Recalculation {
  async function one(period: PayPeriod): Promise<{
    readonly outcome: RecalculationOutcome;
    readonly closed: boolean;
    readonly lastClosed: PayPeriod | null;
  }> {
    const { decision, closed, lastClosed } = await store.recomputeUnscoped(period, decide);
    const said = (outcome: RecalculationOutcome['outcome'], written = 0) => ({
      outcome: { period, outcome, written },
      closed,
      lastClosed,
    });
    if (decision.kind === 'blocked') {
      logger.warn(
        { period, code: decision.error.code, details: decision.error.details },
        'payroll: period not computed',
      );
      return said('blocked');
    }
    if (decision.kind === 'never') return said('never');
    if (decision.drifted.length > 0) {
      logger.error(
        { period, statementIds: decision.drifted },
        'payroll: a validated statement no longer matches its period',
      );
    }
    const written = decision.inserts.length + decision.updates.length;
    return said(written > 0 ? 'written' : 'unchanged', written);
  }

  return {
    async recalculate(period: PayPeriod): Promise<RecalculationOutcome[]> {
      const first = await one(period);
      const open =
        first.closed || first.outcome.outcome === 'never' ? firstOpenPeriod(first.lastClosed) : null;
      if (open === null || open === period) return [first.outcome];
      return [first.outcome, (await one(open)).outcome];
    },
    // A period that breaks does not stop the next ones: each is computed, the break is logged with its period, and the
    // first one fails the run at the end, so that the job stays failed and seen.
    async recalculateOpen(): Promise<RecalculationOutcome[]> {
      const outcomes: RecalculationOutcome[] = [];
      const broken: unknown[] = [];
      for (const period of periodsToRecompute(await store.openPeriodFactsUnscoped(now()))) {
        try {
          outcomes.push((await one(period)).outcome);
        } catch (error) {
          logger.error({ period, err: error }, 'payroll: period not computed, the next ones go on');
          broken.push(error);
        }
      }
      if (broken.length > 0) throw broken[0];
      return outcomes;
    },
  };
}
