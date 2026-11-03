import type {
  CollectiveGoal,
  CommissionStatement,
  PayPeriodWindow,
  PeriodFigures,
  PeriodPace,
  StatementCountedSales,
} from '@nirvana/contracts';

import { reachedBpsOf } from './commission-statements';

const DAY_MS = 86_400_000;

type FigureStatement = Pick<
  CommissionStatement,
  'status' | 'carryOverOutMinor' | 'netMinor' | 'payableMinor'
> & {
  readonly payment: Pick<NonNullable<CommissionStatement['payment']>, 'sentMinor'> | null;
};

/**
 * A period's statements, counted and summed as the list of periods sums them in SQL (`read-store.ts`, `periods`): only
 * a validation makes an amount owed or carried; `paidMinor` is what was sent (ADR 0047 § 2).
 */
export function periodFigures(statements: readonly FigureStatement[]): PeriodFigures {
  const count = (keep: (statement: FigureStatement) => boolean): number => statements.filter(keep).length;
  const sum = (pick: (statement: FigureStatement) => number): number =>
    statements.reduce((total, statement) => total + pick(statement), 0);
  return {
    statements: {
      draft: count((one) => one.status === 'draft'),
      validated: count((one) => one.status === 'validated'),
      paid: count((one) => one.status === 'paid'),
      carried: count((one) => one.carryOverOutMinor !== 0 && one.status !== 'draft'),
    },
    netMinor: sum((one) => one.netMinor),
    payableMinor: sum((one) => one.payableMinor),
    validatedPayableMinor: sum((one) => (one.status === 'draft' ? 0 : one.payableMinor)),
    carriedMinor: sum((one) => (one.status === 'draft' ? 0 : one.carryOverOutMinor)),
    paidMinor: sum((one) => one.payment?.sentMinor ?? 0),
  };
}

/**
 * The net a period's statements count from reports, or sales of the platform (CRM-03), of an earlier period, closed
 * when they came (EQ-04): each line's share of its gross that is late, of its net. They are not the period's own pace.
 */
interface LateLine {
  readonly grossMinor: number;
  readonly netMinor: number;
  readonly lateReports: readonly Pick<
    CommissionStatement['lines'][number]['lateReports'][number],
    'grossMinor'
  >[];
  readonly countedSales: Pick<StatementCountedSales, 'lateNetMinor'> | null;
}

export function lateNetOf(statements: readonly { readonly lines: readonly LateLine[] }[]): number {
  let late = 0;
  for (const line of statements.flatMap((statement) => statement.lines)) {
    const lateGross =
      line.lateReports.reduce((total, report) => total + report.grossMinor, 0) +
      (line.countedSales?.lateNetMinor ?? 0);
    if (lateGross !== 0 && line.grossMinor !== 0)
      late += Math.round((line.netMinor * lateGross) / line.grossMinor);
  }
  return late;
}

/**
 * A figure at the end of the period, at the pace of the time gone by: what late reports brought is counted once, not as
 * pace. The figure itself once the period has ended; `null` before a first full day, when there is no pace to speak of.
 */
export function forecastAtEnd(
  value: number,
  lateValue: number,
  window: Pick<PayPeriodWindow, 'startsAt' | 'endsAt'>,
  now: Date,
): number | null {
  const starts = new Date(window.startsAt).getTime();
  const ends = new Date(window.endsAt).getTime();
  const gone = now.getTime() - starts;
  if (now.getTime() >= ends) return value;
  if (gone < DAY_MS) return null;
  return Math.round(((value - lateValue) * (ends - starts)) / gone) + lateValue;
}

interface PaceInput {
  readonly statements: readonly (Pick<CommissionStatement, 'team'> & {
    readonly lines: readonly LateLine[];
  })[];
  readonly figures: Pick<PeriodFigures, 'netMinor'>;
  readonly window: Pick<PayPeriodWindow, 'startsAt' | 'endsAt'> | null;
  readonly goal: Pick<CollectiveGoal, 'targetMinor'> | null;
  /** A member reads neither the team's net nor its late reports: only how far the team got. */
  readonly self: boolean;
  /**
   * The team's net and late net, read by the server for the goal's one forecast even when the reader may not see them
   * (« ok A », 02/11): only the share of the target is given to a member, never the amounts.
   */
  readonly team: { readonly netMinor: number; readonly lateNetMinor: number };
  readonly now: Date;
}

/**
 * Where a period is heading (ADR 0047 § 2): the agency's late net and forecast net, and, with a collective goal, how
 * far the team got and the one forecast of it, late reports set apart for every reader.
 */
export function periodPace(input: PaceInput): PeriodPace {
  const { window, now } = input;
  const lateNetMinor = input.self ? null : lateNetOf(input.statements);
  const forecastNetMinor =
    input.self || window === null || lateNetMinor === null
      ? null
      : forecastAtEnd(input.figures.netMinor, lateNetMinor, window, now);
  if (input.goal === null) return { lateNetMinor, forecastNetMinor, goal: null };
  const target = input.goal.targetMinor;
  const frozen = input.statements.map((one) => one.team?.collective ?? null).find((one) => one !== null);
  const reachedBps = frozen?.reachedBps ?? (input.self ? null : reachedBpsOf(input.team.netMinor, target));
  const ended = window !== null && now.getTime() >= new Date(window.endsAt).getTime();
  const teamForecast =
    window === null ? null : forecastAtEnd(input.team.netMinor, input.team.lateNetMinor, window, now);
  // Once the period has ended there is nothing left to forecast: the share reached is the forecast.
  const forecastReachedBps = ended
    ? reachedBps
    : teamForecast === null || (input.self && reachedBps === null)
      ? null
      : reachedBpsOf(teamForecast, target);
  return { lateNetMinor, forecastNetMinor, goal: { reachedBps, forecastReachedBps } };
}
