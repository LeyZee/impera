import type { DetectedLink, LinkHourReading, LinkRef } from '@impera/contracts';

import type { LinkRobotHour, LinkStatsConnector, LinkStatsRange } from '../../domain/link-stats';

/**
 * The redirect service in memory (ADR 0120 § 3): hours and robots given by the test, read back by range, and
 * an outage on demand. Like the port, it has nothing that writes to the service.
 */
export class FakeLinkStats implements LinkStatsConnector {
  private readonly hours = new Map<LinkRef, LinkHourReading[]>();
  private readonly robots = new Map<LinkRef, LinkRobotHour[]>();
  private outage: Error | null = null;
  /** The calls made, in order: a test reads them to check what was asked. */
  readonly calls: {
    readonly method: 'listLinks' | 'readHours' | 'readRobotHours';
    readonly link: LinkRef | null;
  }[] = [];
  private links: DetectedLink[] = [];

  seedLinks(...links: readonly DetectedLink[]): this {
    this.links = [...this.links, ...links];
    return this;
  }

  listLinks(): Promise<readonly DetectedLink[]> {
    this.calls.push({ method: 'listLinks', link: null });
    if (this.outage) return Promise.reject(this.outage);
    return Promise.resolve([...this.links]);
  }

  seedHours(link: LinkRef, readings: readonly LinkHourReading[]): this {
    this.hours.set(link, [...(this.hours.get(link) ?? []), ...readings]);
    return this;
  }

  seedRobotHours(link: LinkRef, flagged: readonly LinkRobotHour[]): this {
    this.robots.set(link, [...(this.robots.get(link) ?? []), ...flagged]);
    return this;
  }

  /** Every call fails with `error` until `restore()`. */
  failWith(error: Error): this {
    this.outage = error;
    return this;
  }

  restore(): this {
    this.outage = null;
    return this;
  }

  readHours(link: LinkRef, range: LinkStatsRange): Promise<readonly LinkHourReading[]> {
    this.calls.push({ method: 'readHours', link });
    if (this.outage) return Promise.reject(this.outage);
    const readings = this.hours.get(link) ?? [];
    return Promise.resolve(readings.filter((reading) => within(new Date(reading.hour), range)));
  }

  readRobotHours(link: LinkRef, range: LinkStatsRange): Promise<readonly LinkRobotHour[]> {
    this.calls.push({ method: 'readRobotHours', link });
    if (this.outage) return Promise.reject(this.outage);
    const flagged = this.robots.get(link) ?? [];
    return Promise.resolve(flagged.filter((hour) => within(new Date(hour.hour), range)));
  }
}

function within(at: Date, range: LinkStatsRange): boolean {
  return at >= range.from && at < range.to;
}
