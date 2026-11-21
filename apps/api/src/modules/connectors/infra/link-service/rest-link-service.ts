import {
  DetectedLinkSchema,
  DETECTED_LINK_NAME_MAX,
  type DetectedLink,
  type LinkHourReading,
  type LinkRef,
} from '@impera/contracts';
import { z } from 'zod';

import { LinkServiceError, type LinkServiceReader } from '../../domain/link-service';
import type { LinkRobotHour, LinkStatsRange } from '../../domain/link-stats';
import { isPrivateAddress, pinnedGet, systemLookup, type Lookup, type Pinned } from '../avatar/fetch-avatar';

type FetchLike = (url: string, init: RequestInit, pinned: Pinned) => Promise<Response>;

const TIMEOUT_MS = 10_000;
/** A page of a hundred links is far below: a longer answer is not the one we asked for. */
const RESPONSE_MAX_BYTES = 1024 * 1024;
const PAGE_SIZE = 100;
/** Two thousand links: beyond, the reading stops with an error and never answers a partial list. */
const PAGES_MAX = 20;
const RETRY_AFTER_MAX_SECONDS = 24 * 60 * 60;

const PING_PATH = '/v3/_ping';
const LINKS_PATH = '/v3/links';

/** Totals by hour, views or clicks. The lists of visitors and of origins have no path here: they are never read. */
const HOURS_PATH = '/v3/analytics/time-series';
/** What the service flags, counted by hour. Reading it changes nothing to a link's protection. */
const ROBOTS_PATH = '/v3/analytics/shield';

/** The widest window the service counts by the hour; a reading asks for it whole and keeps the hours of its range. */
const HOURLY_WINDOW = '48h';
/** The window is 48 hours: a longer series is not the one we asked for. */
const BUCKETS_MAX = 72;
const COUNT_MAX = 100_000_000;

const SERVICE_LINK_ID = /^[a-z]{2,8}_[0-9a-f]{16,40}$/u;

const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u;

const PingSchema = z.object({ ok: z.literal(true) });

const PageSchema = z.object({
  has_more: z.boolean(),
  next_cursor: z.string().min(1).max(1024).nullish(),
  data: z.array(z.unknown()).max(PAGE_SIZE),
});

/**
 * What is read of a link, and nothing more: everything else the service sends with it (texts, buttons, notes,
 * tracking settings) is dropped here and never kept, shown nor given to a prompt.
 */
const ServiceLinkSchema = z.object({
  id: z.string().regex(SERVICE_LINK_ID),
  shortcode: z.string().regex(/^[a-z0-9_-]{3,24}$/u),
  domain: z.string().regex(DOMAIN),
  selected_domain: z.string().regex(DOMAIN).nullish(),
  display_name: z.string().nullish(),
});

const count = z.number().int().nonnegative().max(COUNT_MAX);
/** The start of a bucket: an hour sharp in UTC, since the series is asked by the hour in UTC. */
const bucket = z.iso
  .datetime()
  .refine((text) => /T\d{2}:00:00(\.0+)?Z$/u.test(text))
  .transform((text) => new Date(text).toISOString());

const seriesOf = <Item extends z.ZodType>(item: Item) =>
  z.object({ has_more: z.literal(false), data: z.array(item).max(BUCKETS_MAX) });

/** Of each bucket, the one figure asked; whatever else comes with it is dropped. */
const ViewsSchema = seriesOf(z.object({ bucket, pageviews: count }));
const ClicksSchema = seriesOf(z.object({ bucket, button_clicks: count }));
/** Of what the service flags, only the visits it calls robots. */
const RobotsSchema = seriesOf(z.object({ bucket, breakdown: z.object({ bot: count }) }));

function within(hour: string, range: LinkStatsRange): boolean {
  const at = Date.parse(hour);
  return at >= range.from.getTime() && at < range.to.getTime();
}

function detectedOf(raw: unknown): DetectedLink | null {
  const link = ServiceLinkSchema.safeParse(raw);
  if (!link.success) return null;
  const { id, shortcode, domain, selected_domain: selected, display_name: displayName } = link.data;
  const name = (displayName ?? '').trim();
  const detected = DetectedLinkSchema.safeParse({
    ref: id,
    name: (name === '' ? shortcode : name).slice(0, DETECTED_LINK_NAME_MAX),
    url: `https://${selected ?? domain}/${shortcode}`,
  });
  return detected.success ? detected.data : null;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new LinkServiceError('unexpected');
  const announced = Number(response.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(announced) && announced > RESPONSE_MAX_BYTES) {
    await response.body.cancel();
    throw new LinkServiceError('unexpected');
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > RESPONSE_MAX_BYTES) {
      await reader.cancel();
      throw new LinkServiceError('unexpected');
    }
    chunks.push(value);
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed;
  } catch {
    throw new LinkServiceError('unexpected');
  }
}

function retryAfterOf(response: Response): number | null {
  const seconds = Number(response.headers.get('retry-after') ?? Number.NaN);
  if (!Number.isInteger(seconds) || seconds < 0) return null;
  return Math.min(seconds, RETRY_AFTER_MAX_SECONDS);
}

/**
 * The redirect service over HTTPS, read only (ADR 0120 § 3). One function calls it and that function is a GET: the
 * paths are constants, the host is the one of the deployment and no other, the key goes to it alone. The name must
 * resolve to public addresses, the connection goes to the address that was checked, a redirect is an error, the
 * answer is JSON of a bounded size read through a strict schema.
 */
export function createLinkServiceReader(options: {
  /** `linkServiceOriginOf(config.LINK_SERVICE_ORIGIN)`: exactly `https://<domain>`. */
  readonly origin: string;
  readonly key: string;
  readonly fetchLike?: FetchLike;
  readonly lookup?: Lookup;
}): LinkServiceReader {
  const { origin, key, fetchLike = pinnedGet, lookup = systemLookup } = options;

  async function get(path: string, query: Readonly<Record<string, string>> = {}): Promise<unknown> {
    const url = new URL(path, origin);
    if (url.origin !== origin || url.protocol !== 'https:') throw new LinkServiceError('unexpected');
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);

    let response: Response;
    try {
      const addresses = await lookup(url.hostname);
      const [first] = addresses;
      if (first === undefined || addresses.some((resolved) => isPrivateAddress(resolved.address))) {
        throw new LinkServiceError('unavailable');
      }
      response = await fetchLike(
        url.toString(),
        {
          redirect: 'manual',
          headers: { accept: 'application/json', authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
        { address: first.address, family: first.family },
      );
    } catch {
      // A network error names the host: it stops here.
      throw new LinkServiceError('unavailable');
    }

    if (
      response.status === 200 &&
      (response.headers.get('content-type') ?? '').includes('application/json')
    ) {
      try {
        return await boundedJson(response);
      } catch (error) {
        throw error instanceof LinkServiceError ? error : new LinkServiceError('unavailable');
      }
    }
    await response.body?.cancel().catch(() => undefined);
    if (response.status === 401) throw new LinkServiceError('unauthorized');
    if (response.status === 403) throw new LinkServiceError('forbidden');
    if (response.status === 429) throw new LinkServiceError('rate_limited', retryAfterOf(response));
    if (response.status >= 500) throw new LinkServiceError('unavailable', retryAfterOf(response));
    // A redirect among them: followed nowhere.
    throw new LinkServiceError('unexpected');
  }

  /** One hourly series of one link, read through `schema`; a reference the service could not have given is not sent. */
  async function hourly<Series extends z.ZodType>(
    path: string,
    link: LinkRef,
    schema: Series,
    extra: Readonly<Record<string, string>> = {},
  ): Promise<z.infer<Series>> {
    if (!SERVICE_LINK_ID.test(link)) throw new LinkServiceError('unexpected');
    const parsed = schema.safeParse(
      await get(path, {
        link_id: link,
        timeframe: HOURLY_WINDOW,
        interval: 'hour',
        timezone: 'UTC',
        ...extra,
      }),
    );
    if (!parsed.success) throw new LinkServiceError('unexpected');
    return parsed.data;
  }

  return {
    async readHours(link, range) {
      const views = await hourly(HOURS_PATH, link, ViewsSchema, { metric: 'pageviews' });
      const clicks = await hourly(HOURS_PATH, link, ClicksSchema, { metric: 'button_clicks' });
      const hours = new Map<string, LinkHourReading>();
      for (const { bucket: hour, pageviews } of views.data) hours.set(hour, { hour, pageviews, clicks: 0 });
      for (const { bucket: hour, button_clicks: pressed } of clicks.data) {
        hours.set(hour, { hour, pageviews: hours.get(hour)?.pageviews ?? 0, clicks: pressed });
      }
      return [...hours.values()]
        .filter((reading) => within(reading.hour, range) && (reading.pageviews > 0 || reading.clicks > 0))
        .sort((a, b) => a.hour.localeCompare(b.hour));
    },

    async readRobotHours(link, range) {
      const flagged = await hourly(ROBOTS_PATH, link, RobotsSchema);
      const hours = new Map<string, LinkRobotHour>();
      for (const { bucket: hour, breakdown } of flagged.data)
        hours.set(hour, { hour, robots: breakdown.bot });
      return [...hours.values()]
        .filter((robots) => within(robots.hour, range) && robots.robots > 0)
        .sort((a, b) => a.hour.localeCompare(b.hour));
    },

    async ping() {
      if (!PingSchema.safeParse(await get(PING_PATH)).success) throw new LinkServiceError('unexpected');
    },

    async listLinks() {
      const links = new Map<string, DetectedLink>();
      let cursor: string | null = null;
      for (let page = 0; page < PAGES_MAX; page += 1) {
        const query: Record<string, string> = { limit: String(PAGE_SIZE), sort: 'created' };
        if (cursor !== null) query['cursor'] = cursor;
        const parsed = PageSchema.safeParse(await get(LINKS_PATH, query));
        if (!parsed.success) throw new LinkServiceError('unexpected');
        for (const raw of parsed.data.data) {
          const detected = detectedOf(raw);
          if (detected !== null) links.set(detected.ref, detected);
        }
        if (!parsed.data.has_more) return [...links.values()];
        const next = parsed.data.next_cursor ?? null;
        if (next === null || next === cursor) throw new LinkServiceError('unexpected');
        cursor = next;
      }
      throw new LinkServiceError('unexpected');
    },
  };
}
