import { DetectedLinkSchema, DETECTED_LINK_NAME_MAX, type DetectedLink } from '@impera/contracts';
import { z } from 'zod';

import { LinkServiceError, type LinkServiceReader } from '../../domain/link-service';
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
  id: z.string().regex(/^[a-z]{2,8}_[0-9a-f]{16,40}$/u),
  shortcode: z.string().regex(/^[a-z0-9_-]{3,24}$/u),
  domain: z.string().regex(DOMAIN),
  selected_domain: z.string().regex(DOMAIN).nullish(),
  display_name: z.string().nullish(),
});

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

  return {
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
