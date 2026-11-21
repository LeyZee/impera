import type { DetectedLink, LinkHourReading, LinkHourTotal, LinkRef } from '@impera/contracts';

/**
 * The link connector (ADR 0120 § 3), pure: its read-only port, the hours kept of a reading once the robots are
 * removed, and the rule of the red alert on a story link gone silent (§ 6). Nothing of a visitor crosses the port:
 * robots are a number an hour, and nothing else.
 */

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** The days of clicks, each one with at least one, that make a link's silence an alert (§ 6). */
const SILENCE_HABIT_DAYS = 7;

export interface LinkStatsRange {
  readonly from: Date;
  /** Exclusive. */
  readonly to: Date;
}

/** The visits of one hour that the service flags as a robot: a count, never a visit. */
export interface LinkRobotHour {
  /** The start of the hour, UTC. */
  readonly hour: string;
  readonly robots: number;
}

/**
 * The redirect service, read only: the port has no method that creates, changes or removes a link, so no caller can
 * (ADR 0120 § 3). An adapter throws on a refusal or an outage; it never answers with a guess.
 */
export interface LinkStatsConnector {
  /** The links of the account at the service: how it names each one, its name there and its address. No figure. */
  listLinks(): Promise<readonly DetectedLink[]>;
  /** The hours of `link` in `range` as the service counts them, robots included; an hour without a visit may be absent. */
  readHours(link: LinkRef, range: LinkStatsRange): Promise<readonly LinkHourReading[]>;
  /** How many visits of `link` the service flags as a robot, hour by hour in `range`; an hour without one may be absent. */
  readRobotHours(link: LinkRef, range: LinkStatsRange): Promise<readonly LinkRobotHour[]>;
}

function hourStart(at: Date): string {
  return new Date(Math.floor(at.getTime() / HOUR_MS) * HOUR_MS).toISOString();
}

/**
 * The hours kept (§ 3): the service's page views less the robots of that hour, never below zero, with the number of
 * robots beside. Clicks are kept as read: a click is a visit that pressed a button. An hour left with nothing, no
 * view, click nor robot, is not kept. Sorted by hour, one row an hour: a reading replayed gives the same rows.
 */
export function hoursWithoutRobots(
  readings: readonly LinkHourReading[],
  robotHours: readonly LinkRobotHour[],
): LinkHourTotal[] {
  const hours = new Map<string, { pageviews: number; clicks: number; robots: number }>();
  const at = (hour: string) => {
    const known = hours.get(hour);
    if (known) return known;
    const fresh = { pageviews: 0, clicks: 0, robots: 0 };
    hours.set(hour, fresh);
    return fresh;
  };
  for (const reading of readings) {
    const hour = at(hourStart(new Date(reading.hour)));
    hour.pageviews += reading.pageviews;
    hour.clicks += reading.clicks;
  }
  for (const flagged of robotHours) at(hourStart(new Date(flagged.hour))).robots += flagged.robots;
  return [...hours.entries()]
    .map(([hour, total]) => ({
      hour,
      pageviews: Math.max(0, total.pageviews - total.robots),
      clicks: total.clicks,
      robots: total.robots,
    }))
    .filter((total) => total.pageviews > 0 || total.clicks > 0 || total.robots > 0)
    .sort((a, b) => a.hour.localeCompare(b.hour));
}

/** The part of the visits that were robots, 0 to 1; 0 when nothing was read. */
export function robotShare(totals: readonly LinkHourTotal[]): number {
  const robots = totals.reduce((sum, total) => sum + total.robots, 0);
  const visits = totals.reduce((sum, total) => sum + total.pageviews, 0) + robots;
  return visits === 0 ? 0 : robots / visits;
}

/**
 * Whether a story link went silent (§ 6): not one click in the 24 hours before `now`, while each of the seven days
 * before those had at least one. A link that is new, or that never had the habit, is not an alert.
 *
 * The caller passes at least eight days of hours before `now` (the last 24 hours and the seven days of the habit). With
 * less (a first reading, an emptied base) the habit cannot be seen and nothing is raised.
 */
export function storyLinkSilent(totals: readonly LinkHourTotal[], now: Date): boolean {
  const end = now.getTime();
  const clicksIn = (from: number, to: number) =>
    totals.reduce((sum, total) => {
      const hour = Date.parse(total.hour);
      return hour >= from && hour < to ? sum + total.clicks : sum;
    }, 0);
  if (clicksIn(end - DAY_MS, end) > 0) return false;
  for (let day = 1; day <= SILENCE_HABIT_DAYS; day += 1) {
    if (clicksIn(end - (day + 1) * DAY_MS, end - day * DAY_MS) === 0) return false;
  }
  return true;
}
