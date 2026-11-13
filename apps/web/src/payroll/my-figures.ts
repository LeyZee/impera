import { payPeriodLastDay, type Currency, type MyFigures } from '@impera/contracts';

/*
 * « Mes chiffres » as the screens say them (CHF-01, ADR 0104 § A), without React: pure, from the server's answer. The
 * member's own figures only; a fall is never a fault, so no figure here takes a status colour (§ 10).
 */

type Nets = MyFigures['nets'];

const DAY_MS = 86_400_000;

/** The net of `nets` in `currency`, zero when it holds none. */
export const netIn = (nets: Nets, currency: Currency): number =>
  nets.find((net) => net.currency === currency)?.netMinor ?? 0;

/**
 * The currency the charts are drawn in: the one that brings the period under way the most, else the one of the
 * member's records, else the euro. Another currency keeps its lines in « Mes ventes lues ».
 */
export function figuresCurrency(figures: Pick<MyFigures, 'nets' | 'records'>): Currency {
  const [first] = [...figures.nets].sort((a, b) => b.netMinor - a.netMinor);
  return (
    first?.currency ?? figures.records.bestPeriod?.currency ?? figures.records.bestDay?.currency ?? 'EUR'
  );
}

/** Whether the period under way holds lines in another currency than the charts'. */
export const hasOtherCurrency = (figures: Pick<MyFigures, 'nets'>, currency: Currency): boolean =>
  figures.nets.some((net) => net.currency !== currency && net.netMinor !== 0);

const shiftDay = (day: string, count: number): string =>
  new Date(Date.parse(`${day}T00:00:00.000Z`) + count * DAY_MS).toISOString().slice(0, 10);

/** A day of the fortnight as a bar: its net, its sales, and whether it is today or still ahead. */
export interface DayBar {
  readonly day: string;
  readonly netMinor: number;
  readonly sales: number;
  readonly refunds: number;
  readonly today: boolean;
  readonly ahead: boolean;
}

/** Every day of the period under way, the first to the last, the days ahead empty: the fortnight keeps its width. */
export function fortnightBars(
  figures: Pick<MyFigures, 'period' | 'today' | 'days'>,
  currency: Currency,
): DayBar[] {
  const last = payPeriodLastDay(figures.period);
  const found = new Map(figures.days.map((day) => [day.day, day]));
  const bars: DayBar[] = [];
  for (let day: string = figures.period; day <= last; day = shiftDay(day, 1)) {
    const one = found.get(day);
    bars.push({
      day,
      netMinor: one === undefined ? 0 : netIn(one.nets, currency),
      sales: one?.sales ?? 0,
      refunds: one?.refunds ?? 0,
      today: day === figures.today,
      ahead: day > figures.today,
    });
  }
  return bars;
}

/** A bar's height from 0 to 1 against the best day; a refund day stands at the floor, never under it. */
export const barHeight = (netMinor: number, max: number): number =>
  max <= 0 || netMinor <= 0 ? 0 : Math.max(0.04, netMinor / max);

/**
 * The period under way against the one before, stopped at the same day, in %: `null` without a period before, or when
 * it had brought nothing by then (nothing to compare with).
 */
export function fortnightChange(
  figures: Pick<MyFigures, 'nets' | 'previous'>,
  currency: Currency,
): number | null {
  if (figures.previous === null) return null;
  const before = netIn(figures.previous.toDateNets, currency);
  if (before <= 0) return null;
  return Math.round(((netIn(figures.nets, currency) - before) / before) * 100);
}

/** « 18 % », the size of a change: the words beside it say which way, never a sign and a word at once. */
export const changeText = (change: number): string => `${String(Math.abs(change))}\u00a0%`;

/**
 * What the change says in words, never a judgement. It compares the net sold, and says so: read under what the member
 * earns, a bare « de plus » would pass for a rise in pay.
 */
export function changeWords(change: number): string {
  if (change > 0) return 'de net vendu en plus qu’au même jour de ta quinzaine d’avant';
  if (change < 0) return 'de net vendu en moins qu’au même jour de ta quinzaine d’avant';
  return 'Autant de net vendu qu’au même jour de ta quinzaine d’avant';
}

/**
 * Whether a day's bar may wear its figure: the best day always, today only when both its neighbours stand lower, or
 * its label would run over the taller bar beside it. Never a figure on every bar.
 */
export function barLabelled(bars: readonly DayBar[], index: number): boolean {
  const bar = bars[index];
  if (bar === undefined || bar.netMinor <= 0) return false;
  const max = Math.max(...bars.map((one) => one.netMinor));
  if (index === bars.findIndex((one) => one.netMinor === max)) return true;
  if (!bar.today) return false;
  return [bars[index - 1], bars[index + 1]].every((one) => one === undefined || one.netMinor < bar.netMinor);
}

/** A cell of « Quand je vends »: the net and the sales of an hour of a weekday. */
export interface HeatCell {
  readonly netMinor: number;
  readonly sales: number;
}

/** Seven rows, Monday first, of twenty-four hours: the cells the server gave, the others empty. */
export function heatGrid(cells: MyFigures['hours']['cells'], currency: Currency): HeatCell[][] {
  const grid: HeatCell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ netMinor: 0, sales: 0 })),
  );
  for (const cell of cells) {
    const row = grid[cell.weekday - 1];
    if (row !== undefined) row[cell.hour] = { netMinor: netIn(cell.nets, currency), sales: cell.sales };
  }
  return grid;
}

/** The grid in eight slots of three hours a day, for a narrow screen: the sums of each three cells. */
export function heatSlots(grid: readonly (readonly HeatCell[])[]): HeatCell[][] {
  return grid.map((row) =>
    Array.from({ length: 8 }, (_, slot) =>
      row
        .slice(slot * 3, slot * 3 + 3)
        .reduce<HeatCell>(
          (sum, cell) => ({ netMinor: sum.netMinor + cell.netMinor, sales: sum.sales + cell.sales }),
          { netMinor: 0, sales: 0 },
        ),
    ),
  );
}

/** « 21 h », the house's way to write an hour. */
export const hourText = (hour: number): string => `${String(hour % 24)}\u00a0h`;

/** The best three hours in a row of the week, by net: where the member sells the most. `null` on an empty grid. */
export function bestSlot(
  grid: readonly (readonly HeatCell[])[],
): { readonly weekday: number; readonly from: number; readonly share: number } | null {
  const total = grid.flat().reduce((sum, cell) => sum + Math.max(0, cell.netMinor), 0);
  if (total <= 0) return null;
  let best: { weekday: number; from: number; net: number } | null = null;
  for (const [index, row] of grid.entries()) {
    for (let from = 0; from <= 21; from += 1) {
      const net = row.slice(from, from + 3).reduce((sum, cell) => sum + Math.max(0, cell.netMinor), 0);
      // Three hours that tie on the same day: the ones that start on a sale, not on two empty hours before it.
      const tied =
        best !== null &&
        net === best.net &&
        best.weekday === index + 1 &&
        (row[best.from]?.netMinor ?? 0) <= 0;
      if (best === null || net > best.net || tied) best = { weekday: index + 1, from, net };
    }
  }
  return best === null
    ? null
    : { weekday: best.weekday, from: best.from, share: Math.round((best.net / total) * 100) };
}

export const WEEKDAY_NAMES = [
  'Lundi',
  'Mardi',
  'Mercredi',
  'Jeudi',
  'Vendredi',
  'Samedi',
  'Dimanche',
] as const;
export const WEEKDAY_SHORT = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'] as const;

/** « le mardi de 21 h à minuit », « le jeudi de 9 h à 12 h ». */
export function slotWords(slot: { readonly weekday: number; readonly from: number }): string {
  const to = slot.from + 3;
  const day = (WEEKDAY_NAMES[slot.weekday - 1] ?? '').toLowerCase();
  return `le ${day} de ${String(slot.from)}\u00a0h à ${to === 24 ? 'minuit' : `${String(to)}\u00a0h`}`;
}

/** How far a tier's ring is drawn, from 0 to 1, between the tier reached and the next. */
export function tierShare(netMinor: number, fromMinor: number, nextMinor: number): number {
  if (nextMinor <= fromMinor) return 1;
  return Math.min(1, Math.max(0, (netMinor - fromMinor) / (nextMinor - fromMinor)));
}

/** Whether the member has a record to read at all. */
export const hasRecords = (figures: Pick<MyFigures, 'records'>): boolean =>
  figures.records.bestDay !== null || figures.records.bestPeriod !== null;

/** Whether today's net is the member's best day ever: the record is being set now. */
export function recordToday(figures: Pick<MyFigures, 'records' | 'today'>): boolean {
  return figures.records.bestDay?.day === figures.today;
}
