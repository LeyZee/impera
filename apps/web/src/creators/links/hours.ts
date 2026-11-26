import {
  LINK_HOURS_SHOWN,
  LINK_PLACEMENTS,
  type AgencyLinkHour,
  type AgencyRedirectLink,
  type LinkPlacement,
} from '@impera/contracts';

/*
 * Trafic › « Ses clics, heure par heure » (INS-02 lot e3): what the hourly reading of her linked links says, made into
 * the screen's figures. Pure: the hours come from the server, `now` from the caller.
 */

const HOUR_MS = 3_600_000;
/** The columns drawn: the last day; the day before it is only compared with. */
export const HOURS_DRAWN = LINK_HOURS_SHOWN / 2;

/** One colour per place, the same in the legend, the columns and the list of links. */
export const PLACEMENT_COLOURS: Readonly<Record<LinkPlacement, string>> = {
  story_daily: 'var(--nv-series-1)',
  story_highlight: 'var(--nv-series-2)',
  telegram_channel: 'var(--nv-series-3)',
  other_network: 'var(--nv-series-4)',
};

export interface HourColumn {
  /** The hour's start, as the server wrote it. */
  readonly key: string;
  readonly hour: Date;
  /** Clicks by place, in `LINK_PLACEMENTS` order. */
  readonly clicks: readonly number[];
  readonly total: number;
  readonly pageviews: number;
  readonly robots: number;
  /** The hour still running: its count grows until it is closed. */
  readonly open: boolean;
}

export interface LinkDay {
  readonly link: AgencyRedirectLink;
  readonly clicks: number;
  /** Its clicks hour by hour over the columns drawn, for its small curve. */
  readonly curve: readonly number[];
}

export interface HoursView {
  readonly columns: readonly HourColumn[];
  /** Clicks over the last 24 hours, and over the 24 before them. */
  readonly clicks: number;
  readonly clicksBefore: number;
  readonly pageviews: number;
  readonly robots: number;
  /** The places that had a click in the columns drawn, in the legend's order. */
  readonly placements: readonly LinkPlacement[];
  /** Her linked links, the most clicked first. */
  readonly links: readonly LinkDay[];
}

const startOfHour = (at: Date): number => Math.floor(at.getTime() / HOUR_MS) * HOUR_MS;

/** The last day hour by hour, the day before summed, her linked links ranked. Hours of an unknown link are left out. */
export function hoursView(
  hours: readonly AgencyLinkHour[],
  links: readonly AgencyRedirectLink[],
  now: Date,
): HoursView {
  const byId = new Map(links.map((link) => [link.id, link]));
  const last = startOfHour(now);
  const first = last - (HOURS_DRAWN - 1) * HOUR_MS;
  const columns = Array.from({ length: HOURS_DRAWN }, (_, i) => ({
    hour: new Date(first + i * HOUR_MS),
    clicks: LINK_PLACEMENTS.map(() => 0),
    pageviews: 0,
    robots: 0,
    open: false,
  }));
  const curves = new Map<string, number[]>();
  let clicksBefore = 0;
  for (const row of hours) {
    const link = byId.get(row.linkId);
    if (link === undefined) continue;
    const at = Date.parse(row.hour);
    const i = Math.round((at - first) / HOUR_MS);
    if (i < 0) {
      if (i >= -HOURS_DRAWN) clicksBefore += row.clicks;
      continue;
    }
    const column = columns[i];
    if (column === undefined) continue;
    const p = link.placement === null ? -1 : LINK_PLACEMENTS.indexOf(link.placement);
    if (p >= 0) column.clicks[p] = (column.clicks[p] ?? 0) + row.clicks;
    column.pageviews += row.pageviews;
    column.robots += row.robots;
    column.open ||= !row.closed;
    const curve = curves.get(link.id) ?? Array.from({ length: HOURS_DRAWN }, () => 0);
    curve[i] = (curve[i] ?? 0) + row.clicks;
    curves.set(link.id, curve);
  }
  const drawn = columns.map((column) => ({
    ...column,
    key: column.hour.toISOString(),
    total: column.clicks.reduce((sum, value) => sum + value, 0),
  }));
  const sum = (pick: (column: HourColumn) => number): number =>
    drawn.reduce((total, column) => total + pick(column), 0);
  const ranked = links
    .filter((link) => link.attached)
    .map((link) => {
      const curve = curves.get(link.id) ?? Array.from({ length: HOURS_DRAWN }, () => 0);
      return { link, curve, clicks: curve.reduce((total, value) => total + value, 0) };
    })
    .sort((one, other) => other.clicks - one.clicks || one.link.name.localeCompare(other.link.name, 'fr'));
  return {
    columns: drawn,
    clicks: sum((column) => column.total),
    clicksBefore,
    pageviews: sum((column) => column.pageviews),
    robots: sum((column) => column.robots),
    placements: LINK_PLACEMENTS.filter((_, p) => drawn.some((column) => (column.clicks[p] ?? 0) > 0)),
    links: ranked,
  };
}

/** The change against the day before, in whole percent; null when the day before had none to compare with. */
export function changePercent(now: number, before: number): number | null {
  if (before <= 0) return null;
  return Math.round(((now - before) / before) * 100);
}

/** The share of robot visits among all visits, in whole percent. */
export function robotShare(pageviews: number, robots: number): number {
  const all = pageviews + robots;
  return all === 0 ? 0 : Math.round((robots / all) * 100);
}

export function clicksText(clicks: number): string {
  return clicks === 1 ? '1 clic' : `${clicks.toLocaleString('fr-FR')} clics`;
}

/** « 14 h », in the reader's time. */
export function hourText(hour: Date, timeZone?: string): string {
  const value = new Intl.DateTimeFormat('fr-FR', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(
    hour,
  );
  return `${String(Number(value.replace(/\D/gu, '')))} h`;
}
