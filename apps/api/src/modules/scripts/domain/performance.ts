import type {
  Currency,
  PlatformScriptId,
  PlatformScriptMoment,
  RevealStepTotals,
  ScriptPerformanceDto,
  ScriptRunStep,
  ScriptStepPerformance,
} from '@impera/contracts';

/**
 * The performance of her scripts (ADR 0129, sous-lot 4c): pure. The runs of the period, the script's steps by rank and
 * Reveal's daily readings come in; one line per script goes out, every rate held back under the minimum of fans
 * (§ 8). No call to anything, no « l'IA pense que ».
 */

/** The key of a step's readings: its account and its ref, a ref being the platform's and only unique on its account. */
export const readingKey = (platformAccountId: string, stepRef: string): string =>
  `${platformAccountId}|${stepRef}`;

/** One step of the script as imported: its rank, each branch's `readingKey`, paid or offered. */
interface MeasuredStep {
  readonly rank: number;
  readonly refs: readonly string[];
  readonly paid: boolean;
}

export interface MeasuredScript {
  readonly id: PlatformScriptId;
  readonly ref: string;
  readonly name: string;
  readonly moment: PlatformScriptMoment | null;
  readonly currency: Currency;
  readonly steps: readonly MeasuredStep[];
}

/** A run of the period with this script: its steps as `script_runs` keeps them. */
export interface PeriodRun {
  readonly scriptRef: string;
  readonly steps: readonly Pick<ScriptRunStep, 'stepIndex' | 'outcome' | 'priceMinor'>[];
}

/** One daily reading of a step's totals (`platform_script_step_daily`): cumulative since the step exists. */
export interface DailyReading {
  readonly day: string;
  readonly sent: number;
  readonly purchased: number;
  readonly paidMinor: number;
}

/** The period's first day and its last, in the platform's calendar (`YYYY-MM-DD`). */
export interface PeriodDays {
  readonly from: string;
  readonly to: string;
}

/**
 * What Reveal counted for one step's ref over the period: its last reading of the period less the last before it. With
 * no reading before, the period's first reading is the base and the count starts that day (`since`). `null` without a
 * reading in the period. Readings are cumulative: a count that went down (a step reset on the platform) is taken as 0.
 */
export function revealOver(
  readings: readonly DailyReading[],
  period: PeriodDays,
): { readonly totals: RevealStepTotals; readonly since: string } | null {
  const sorted = [...readings].sort((a, b) => a.day.localeCompare(b.day));
  const inPeriod = sorted.filter((reading) => reading.day >= period.from && reading.day <= period.to);
  const end = inPeriod.at(-1);
  if (end === undefined) return null;
  const before = sorted.filter((reading) => reading.day < period.from).at(-1);
  const base = before ?? inPeriod[0] ?? end;
  return {
    totals: {
      sent: Math.max(0, end.sent - base.sent),
      purchased: Math.max(0, end.purchased - base.purchased),
      paidMinor: Math.max(0, end.paidMinor - base.paidMinor),
    },
    since: before === undefined ? base.day : period.from,
  };
}

const rateOf = (part: number, whole: number, minFans: number): number | null =>
  whole < minFans ? null : part / whole;

/** One script's line over the period. `runs` are this script's only; `readings` by `readingKey`. */
export function scriptPerformanceOf(
  script: MeasuredScript,
  runs: readonly PeriodRun[],
  readings: ReadonlyMap<string, readonly DailyReading[]>,
  period: PeriodDays,
  minFans: number,
): ScriptPerformanceDto {
  let revenueMinor = 0;
  const sent = new Map<number, number>();
  const bought = new Map<number, number>();
  for (const run of runs) {
    // A step is counted once per run: the run is one fan (a script never runs twice with the same, ADR 0098).
    const seen = new Set<number>();
    for (const step of run.steps) {
      if (seen.has(step.stepIndex)) continue;
      seen.add(step.stepIndex);
      sent.set(step.stepIndex, (sent.get(step.stepIndex) ?? 0) + 1);
      if (step.outcome === 'bought') {
        bought.set(step.stepIndex, (bought.get(step.stepIndex) ?? 0) + 1);
        revenueMinor += step.priceMinor ?? 0;
      }
    }
  }
  const sinces: string[] = [];
  const steps = script.steps.map((step): ScriptStepPerformance => {
    const received = sent.get(step.rank) ?? 0;
    const purchases = step.paid ? (bought.get(step.rank) ?? 0) : 0;
    const branches = step.refs.map((ref) => revealOver(readings.get(ref) ?? [], period));
    const read = branches.flatMap((branch) => (branch === null ? [] : [branch]));
    // Reveal's count of a step holds only once each of its branches has a reading in the period.
    const counted = read.length > 0 && read.length === branches.length;
    for (const branch of read) sinces.push(branch.since);
    return {
      rank: step.rank,
      paid: step.paid,
      sent: received,
      bought: purchases,
      purchaseRate: step.paid ? rateOf(purchases, received, minFans) : null,
      reveal: counted
        ? read.reduce<RevealStepTotals>(
            (sum, branch) => ({
              sent: sum.sent + branch.totals.sent,
              purchased: sum.purchased + branch.totals.purchased,
              paidMinor: sum.paidMinor + branch.totals.paidMinor,
            }),
            { sent: 0, purchased: 0, paidMinor: 0 },
          )
        : null,
    };
  });
  const fans = runs.length;
  return {
    id: script.id,
    name: script.name,
    moment: script.moment,
    currency: script.currency,
    fans,
    revenueMinor,
    revenuePerFanMinor: fans < minFans ? null : Math.round(revenueMinor / fans),
    steps,
    // The latest start among its branches: from that day on, every count of the script covers the same days.
    revealSince: sinces.length === 0 ? null : (sinces.sort().at(-1) ?? null),
  };
}

/** The most revenue per fan first; the scripts under the minimum last, the most fans first among them (§ 15). */
export function rankPerformances(lines: readonly ScriptPerformanceDto[]): ScriptPerformanceDto[] {
  return [...lines].sort((a, b) => {
    if (a.revenuePerFanMinor === null || b.revenuePerFanMinor === null) {
      if (a.revenuePerFanMinor !== null) return -1;
      if (b.revenuePerFanMinor !== null) return 1;
      return b.fans - a.fans || a.name.localeCompare(b.name);
    }
    return b.revenuePerFanMinor - a.revenuePerFanMinor || b.fans - a.fans || a.name.localeCompare(b.name);
  });
}
