import {
  calendarDayAt,
  MY_FIGURES_MIN_SALES,
  MY_FIGURES_WEEKS,
  previousPayPeriod,
  type Currency,
  type MyFigures,
  type MyFiguresCell,
  type MyFiguresDay,
  type PayPeriod,
  type SaleEvent,
} from '@impera/contracts';

/**
 * A member's own figures (ADR 0104 § A), pure: from the lines of their own statements only, never from the register.
 * Nothing here compares them to anyone, and nothing here enters a statement.
 */

/** A line of one of the member's statements, with the period that statement pays. */
export interface FigureLine {
  readonly period: PayPeriod;
  readonly event: SaleEvent;
  readonly currency: Currency;
  readonly netMinor: number;
  readonly occurredAt: Date | null;
}

type Net = MyFigures['nets'][number];

const DAY_MS = 86_400_000;

function netsOf(lines: readonly Pick<FigureLine, 'currency' | 'netMinor'>[]): Net[] {
  const sums = new Map<Currency, number>();
  for (const line of lines) sums.set(line.currency, (sums.get(line.currency) ?? 0) + line.netMinor);
  return [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([currency, netMinor]) => ({ currency, netMinor }));
}

const dayOfLine = (line: FigureLine, timeZone: string): string | null =>
  line.occurredAt === null ? null : calendarDayAt(line.occurredAt, timeZone);

/**
 * The day a line counts on in the period that pays it: its own, or the period's first day when it came late (its own
 * day is before the period), so the days of a period add up to the lines that have an instant.
 */
function paidDayOf(line: FigureLine, timeZone: string): string | null {
  const day = dayOfLine(line, timeZone);
  return day === null ? null : day < line.period ? line.period : day;
}

/** The days of `lines` that have an instant, the oldest first, a late line on its period's first day. */
function daysOf(lines: readonly FigureLine[], timeZone: string): MyFiguresDay[] {
  const groups = new Map<string, FigureLine[]>();
  for (const line of lines) {
    const day = paidDayOf(line, timeZone);
    if (day === null) continue;
    groups.set(day, [...(groups.get(day) ?? []), line]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, group]) => ({
      day,
      sales: group.filter((line) => line.event === 'sale').length,
      refunds: group.filter((line) => line.event !== 'sale').length,
      nets: netsOf(group),
    }));
}

/** `day` moved by `count` days, as a calendar day. */
function shiftDay(day: string, count: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + count * DAY_MS).toISOString().slice(0, 10);
}

const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / DAY_MS);

const WEEKDAYS: Readonly<Record<string, number>> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The weekday (1 Monday to 7 Sunday) and the hour of `at` in `timeZone`. */
export function weekHourAt(at: Date, timeZone: string): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = WEEKDAYS[get('weekday')];
  if (weekday === undefined) throw new Error('A weekday was not read');
  return { weekday, hour: Number(get('hour')) };
}

/** The currency that brought the member the most, over all their lines; `null` without a line. */
export function mainCurrencyOf(lines: readonly FigureLine[]): Currency | null {
  const [first] = netsOf(lines).sort((a, b) => b.netMinor - a.netMinor);
  return first?.currency ?? null;
}

/** The best of `sums` when it brought something: a record is never a zero nor a loss. */
function bestOf<Key extends string>(sums: ReadonlyMap<Key, number>): { key: Key; netMinor: number } | null {
  let best: { key: Key; netMinor: number } | null = null;
  // The first to reach an amount keeps it: an equal later day does not take the record.
  for (const [key, netMinor] of [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (netMinor > 0 && (best === null || netMinor > best.netMinor)) best = { key, netMinor };
  }
  return best;
}

/**
 * The member's figures at `now`:
 * - the period under way day by day in the agency's zone, and the period before, stopped at the same day of the
 *   fortnight (a line without an instant counts in a period's net, never in a day; a line that comes late counts from
 *   the first day);
 * - the sales of the last `MY_FIGURES_WEEKS` weeks by weekday and hour, in the member's own zone;
 * - their best day and best fortnight, in the currency that brought them the most.
 */
export function myFigures(input: {
  readonly lines: readonly FigureLine[];
  readonly now: Date;
  readonly agencyZone: string;
  readonly memberZone: string;
  readonly period: PayPeriod;
}): MyFigures {
  const { lines, now, agencyZone, memberZone, period } = input;
  const today = calendarDayAt(now, agencyZone);
  const current = lines.filter((line) => line.period === period);
  const before = previousPayPeriod(period);
  const previous = lines.filter((line) => line.period === before);
  const sameDay = shiftDay(before, daysBetween(period, today));
  const toDate = previous.filter((line) => {
    const day = paidDayOf(line, agencyZone);
    return day !== null && day <= sameDay;
  });

  const since = new Date(now.getTime() - MY_FIGURES_WEEKS * 7 * DAY_MS);
  const recent = lines.filter(
    (line) => line.event === 'sale' && line.occurredAt !== null && line.occurredAt >= since,
  );
  const cells = new Map<string, { weekday: number; hour: number; lines: FigureLine[] }>();
  for (const line of recent) {
    if (line.occurredAt === null) continue;
    const { weekday, hour } = weekHourAt(line.occurredAt, memberZone);
    const key = `${String(weekday)}:${String(hour)}`;
    const cell = cells.get(key) ?? { weekday, hour, lines: [] };
    cell.lines.push(line);
    cells.set(key, cell);
  }
  const grid: MyFiguresCell[] = [...cells.values()]
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour)
    .map((cell) => ({
      weekday: cell.weekday,
      hour: cell.hour,
      sales: cell.lines.length,
      nets: netsOf(cell.lines),
    }));

  const currency = mainCurrencyOf(lines);
  const ofMain = lines.filter((line) => line.currency === currency);
  const byDay = new Map<string, number>();
  const byPeriod = new Map<PayPeriod, number>();
  for (const line of ofMain) {
    byPeriod.set(line.period, (byPeriod.get(line.period) ?? 0) + line.netMinor);
    const day = dayOfLine(line, agencyZone);
    if (day !== null) byDay.set(day, (byDay.get(day) ?? 0) + line.netMinor);
  }
  const bestDay = bestOf(byDay);
  const bestPeriod = bestOf(byPeriod);

  return {
    period,
    today,
    timeZone: memberZone,
    days: daysOf(current, agencyZone),
    nets: netsOf(current),
    previous:
      previous.length === 0
        ? null
        : { period: before, days: daysOf(previous, agencyZone), toDateNets: netsOf(toDate) },
    hours: {
      since: calendarDayAt(since, agencyZone),
      sales: recent.length,
      enough: recent.length >= MY_FIGURES_MIN_SALES,
      cells: grid,
    },
    records: {
      bestDay:
        bestDay === null || currency === null
          ? null
          : { day: bestDay.key, currency, netMinor: bestDay.netMinor },
      bestPeriod:
        bestPeriod === null || currency === null
          ? null
          : { period: bestPeriod.key, currency, netMinor: bestPeriod.netMinor },
    },
  };
}
