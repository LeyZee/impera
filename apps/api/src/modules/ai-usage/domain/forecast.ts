import {
  AI_FORECAST_TRAFFIC_GROWTH,
  AiSpendLineSchema,
  type AiForecast,
  type AiForecastRange,
  type AiSpendLine,
} from '@impera/contracts';

/**
 * The journal of calls summed by local day, line of spend and creator (ADR 0091 § 8). `conversations`: the distinct
 * conversations the group's calls served, counted on `chatting` alone (0 elsewhere).
 */
export interface ForecastRow {
  readonly day: string;
  readonly line: AiSpendLine;
  /** Null for the playground, the tests and the « Essai réel »: they belong to no creator. */
  readonly creatorId: string | null;
  readonly usd: number;
  readonly conversations: number;
}

/** The sales net of the platform of one creator's local day, in euros, refunds taken off. */
export interface SalesRow {
  readonly day: string;
  readonly creatorId: string;
  readonly netEur: number;
}

export interface ForecastInput {
  readonly rows: readonly ForecastRow[];
  readonly sales: readonly SalesRow[];
  /** The creators' names, by id; a creator missing here is shown under her id's first characters. */
  readonly creatorNames: ReadonlyMap<string, string>;
  /** Today in the cap's zone, YYYY-MM-DD. */
  readonly today: string;
  readonly usdPerEur: number;
  readonly capEur: number;
}

/** Days the pace is read over at most: the latest week, and the one before it for the band. */
const BASIS_DAYS = 14;
const WEEK = 7;
/** Under eight full days there is no week before to compare with: a fixed band around the pace. */
const THIN_LOW = 0.8;
const THIN_HIGH = 1.25;
const DAY_MS = 86_400_000;

function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function daysInMonth(month: string): number {
  const [year, m] = month.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, m ?? 1, 0)).getUTCDate();
}

function nextMonthOf(month: string): string {
  const [year, m] = month.split('-').map(Number);
  const next = new Date(Date.UTC(year ?? 1970, m ?? 1, 1));
  return next.toISOString().slice(0, 7);
}

const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

/**
 * A day's pace from its series over the basis days (oldest first): realistic is the latest week, as « Prévu fin du
 * mois » takes it; low and high are the calmer and the busier of that week and the one before it.
 */
export function paceOf(series: readonly number[]): AiForecastRange {
  const latest = mean(series.slice(-WEEK));
  if (series.length <= WEEK) return { low: latest * THIN_LOW, realistic: latest, high: latest * THIN_HIGH };
  const before = mean(series.slice(0, -WEEK));
  return { low: Math.min(latest, before), realistic: latest, high: Math.max(latest, before) };
}

const scale = (range: AiForecastRange, by: (perDay: number) => number): AiForecastRange => ({
  low: by(range.low),
  realistic: by(range.realistic),
  high: by(range.high),
});

/**
 * What the AI will cost this month and next (ADR 0091 § 8), by line of spend and by creator, against the sales of the
 * same days. Pure: the day and the cap are given. Null before a first full day with a call.
 */
export function aiForecast(input: ForecastInput): AiForecast | null {
  const { today, usdPerEur } = input;
  const firstCall = input.rows.reduce<string | null>(
    (first, r) => (r.usd > 0 && (first === null || r.day < first) ? r.day : first),
    null,
  );
  if (firstCall === null || firstCall >= today) return null;
  const from = firstCall > addDays(today, -BASIS_DAYS) ? firstCall : addDays(today, -BASIS_DAYS);
  const basis = Array.from({ length: Math.round((Date.parse(today) - Date.parse(from)) / DAY_MS) }, (_, i) =>
    addDays(from, i),
  );

  const month = today.slice(0, 7);
  const daysLeft = daysInMonth(month) - Number(today.slice(8, 10));
  const nextMonth = nextMonthOf(month);
  const nextDays = daysInMonth(nextMonth);

  /** A subset of rows priced in euros: its daily series over the basis, its month so far, and the forecast. */
  const project = (eurOfDay: (day: string) => number, monthSoFarEur: number) => {
    const perDay = paceOf(basis.map(eurOfDay));
    return {
      perDay,
      monthSoFarEur,
      thisMonth: scale(perDay, (d) => monthSoFarEur + d * daysLeft),
      nextMonth: scale(perDay, (d) => d * nextDays),
    };
  };
  const spend = (keep: (r: ForecastRow) => boolean) => {
    const rows = input.rows.filter(keep);
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.usd / usdPerEur);
    const soFar = rows
      .filter((r) => r.day.startsWith(month) && r.day <= today)
      .reduce((total, r) => total + r.usd / usdPerEur, 0);
    return project((day) => byDay.get(day) ?? 0, soFar);
  };

  const total = spend(() => true);
  const lines = AiSpendLineSchema.options
    .flatMap((line) => {
      const projected = spend((r) => r.line === line);
      return projected.monthSoFarEur === 0 && projected.perDay.high === 0 ? [] : [{ line, ...projected }];
    })
    .sort((a, b) => b.nextMonth.realistic - a.nextMonth.realistic);
  const chatting = lines.find((l) => l.line === 'chatting')?.perDay.realistic ?? 0;

  const latestWeek = new Set(basis.slice(-WEEK));
  const weekDays = latestWeek.size;
  const conversationsOf = (keep: (r: ForecastRow) => boolean): number =>
    input.rows
      .filter((r) => r.line === 'chatting' && latestWeek.has(r.day) && keep(r))
      .reduce((sum, r) => sum + r.conversations, 0) / weekDays;
  const conversationsPerDay = conversationsOf(() => true);

  const salesOf = (keep: (r: SalesRow) => boolean) => {
    const rows = input.sales.filter(keep);
    if (rows.length === 0) return null;
    const byDay = new Map<string, number>();
    for (const r of rows) byDay.set(r.day, (byDay.get(r.day) ?? 0) + r.netEur);
    const soFar = rows
      .filter((r) => r.day.startsWith(month) && r.day <= today)
      .reduce((sum, r) => sum + r.netEur, 0);
    // A month of refunds above its sales is read as nothing sold, never as a negative forecast.
    return project((day) => Math.max(0, byDay.get(day) ?? 0), Math.max(0, soFar));
  };
  const sales = salesOf(() => true);

  const creatorIds = [...new Set(input.rows.flatMap((r) => (r.creatorId === null ? [] : [r.creatorId])))];
  const creators = creatorIds
    .map((creatorId) => {
      const projected = spend((r) => r.creatorId === creatorId);
      const hers = salesOf((r) => r.creatorId === creatorId);
      return {
        creatorId,
        name: input.creatorNames.get(creatorId) ?? creatorId.slice(0, 8),
        monthSoFarEur: projected.monthSoFarEur,
        thisMonth: projected.thisMonth,
        nextMonth: projected.nextMonth,
        conversationsPerDay: conversationsOf((r) => r.creatorId === creatorId),
        salesMonthSoFarEur: hers === null ? null : hers.monthSoFarEur,
        aiShareSoFar:
          hers === null || hers.monthSoFarEur === 0 ? null : projected.monthSoFarEur / hers.monthSoFarEur,
        salesNextMonthEur: hers === null ? null : hers.nextMonth.realistic,
      };
    })
    .sort((a, b) => b.nextMonth.realistic - a.nextMonth.realistic);

  const morePerDay = total.perDay.realistic + chatting * AI_FORECAST_TRAFFIC_GROWTH;
  const chattingWeekEur = (lines.find((l) => l.line === 'chatting')?.perDay.realistic ?? 0) * weekDays;
  const conversationDays = conversationsPerDay * weekDays;

  return {
    basisDays: basis.length,
    thisMonth: { month, monthSoFarEur: total.monthSoFarEur, ...total.thisMonth },
    nextMonth: { month: nextMonth, ...total.nextMonth },
    lines: lines.map((l) => ({
      line: l.line,
      monthSoFarEur: l.monthSoFarEur,
      perDay: l.perDay,
      thisMonth: l.thisMonth,
      nextMonth: l.nextMonth,
    })),
    creators,
    conversationsPerDay,
    eurPerConversationDay: conversationDays === 0 ? null : chattingWeekEur / conversationDays,
    moreTraffic: {
      thisMonthEur: total.monthSoFarEur + morePerDay * daysLeft,
      nextMonthEur: morePerDay * nextDays,
    },
    cap: {
      capEur: input.capEur,
      reachedAtRealistic: total.perDay.realistic > input.capEur,
      reachedWithMoreTraffic: morePerDay > input.capEur,
      nextMonthMaxEur: input.capEur * nextDays,
    },
    sales:
      sales === null || sales.nextMonth.realistic === 0
        ? null
        : {
            monthSoFarEur: sales.monthSoFarEur,
            aiShareSoFar: sales.monthSoFarEur === 0 ? null : total.monthSoFarEur / sales.monthSoFarEur,
            thisMonthEur: sales.thisMonth.realistic,
            nextMonthEur: sales.nextMonth.realistic,
            aiShare: total.nextMonth.realistic / sales.nextMonth.realistic,
          },
  };
}
