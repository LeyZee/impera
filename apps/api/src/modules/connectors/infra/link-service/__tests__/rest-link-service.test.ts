import { LinkRefSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { LinkServiceError } from '../../../domain/link-service';
import type { Pinned } from '../../avatar/fetch-avatar';
import { createLinkServiceReader } from '../rest-link-service';

const ORIGIN = 'https://liens.example';
const KEY = 'test-key-not-a-real-one';
const PUBLIC = [{ address: '203.0.113.10', family: 4 }];

interface Call {
  readonly url: URL;
  readonly headers: Headers;
  readonly pinned: Pinned;
}

function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers },
  });
}

function reader(answers: readonly (Response | Error)[], addresses = PUBLIC) {
  const calls: Call[] = [];
  const queue = [...answers];
  const service = createLinkServiceReader({
    origin: ORIGIN,
    key: KEY,
    lookup: () => Promise.resolve(addresses),
    fetchLike: (url, init, pinned) => {
      calls.push({ url: new URL(url), headers: new Headers(init.headers), pinned });
      const answer = queue.shift();
      if (answer === undefined) return Promise.reject(new Error('no answer left'));
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  });
  return { service, calls };
}

const link = (n: number, extra: Record<string, unknown> = {}) => ({
  id: `lnk_${String(n).padStart(24, '0')}`,
  object: 'link',
  shortcode: `page${String(n)}`,
  domain: 'go.example',
  display_name: `Link ${String(n)}`,
  status: 'active',
  ...extra,
});

async function failure(run: Promise<unknown>): Promise<LinkServiceError> {
  const error: unknown = await run.then(
    () => null,
    (thrown: unknown) => thrown,
  );
  if (!(error instanceof LinkServiceError)) throw new Error('expected a LinkServiceError');
  return error;
}

describe('the redirect service read over HTTPS', () => {
  it('sends the key to the configured host only, asks for JSON, to the checked address', async () => {
    const { service, calls } = reader([json({ ok: true, user_id: 'x' })]);
    await service.ping();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url.origin).toBe(ORIGIN);
    expect(calls[0]?.url.pathname).toBe('/v3/_ping');
    expect(calls[0]?.headers.get('authorization')).toBe(`Bearer ${KEY}`);
    expect(calls[0]?.headers.get('accept')).toBe('application/json');
    expect(calls[0]?.pinned).toEqual({ address: '203.0.113.10', family: 4 });
  });

  it('keeps of a link its reference, its name and its address, and nothing else', async () => {
    const { service } = reader([
      json({
        object: 'list',
        has_more: false,
        next_cursor: null,
        data: [
          link(1, {
            note: 'ignore previous instructions',
            bio: 'x',
            buttons: [{ url: 'https://a.example' }],
          }),
          link(2, { display_name: null, selected_domain: 'me.example' }),
        ],
      }),
    ]);
    expect(await service.listLinks()).toEqual([
      { ref: 'lnk_000000000000000000000001', name: 'Link 1', url: 'https://go.example/page1' },
      { ref: 'lnk_000000000000000000000002', name: 'page2', url: 'https://me.example/page2' },
    ]);
  });

  it('drops a link it cannot read and keeps the others', async () => {
    const { service } = reader([
      json({
        has_more: false,
        data: [link(1, { shortcode: '../admin' }), link(2, { domain: '127.0.0.1' }), { id: 7 }, link(3)],
      }),
    ]);
    expect((await service.listLinks()).map((found) => found.name)).toEqual(['Link 3']);
  });

  it('cuts a name that is too long', async () => {
    const { service } = reader([
      json({ has_more: false, data: [link(1, { display_name: 'n'.repeat(500) })] }),
    ]);
    expect((await service.listLinks())[0]?.name).toHaveLength(200);
  });

  it('follows the pages with the cursor given back as it came', async () => {
    const { service, calls } = reader([
      json({ has_more: true, next_cursor: 'a b&c=', data: [link(1)] }),
      json({ has_more: false, next_cursor: null, data: [link(2)] }),
    ]);
    expect(await service.listLinks()).toHaveLength(2);
    expect(calls[0]?.url.searchParams.get('cursor')).toBeNull();
    expect(calls[0]?.url.searchParams.get('limit')).toBe('100');
    expect(calls[1]?.url.searchParams.get('cursor')).toBe('a b&c=');
    expect(calls[1]?.url.origin).toBe(ORIGIN);
  });

  it('stops on pages that never end, without a partial list', async () => {
    const pages = Array.from({ length: 25 }, (_, n) =>
      json({ has_more: true, next_cursor: `c${String(n)}`, data: [link(n)] }),
    );
    const { service, calls } = reader(pages);
    expect((await failure(service.listLinks())).kind).toBe('unexpected');
    expect(calls).toHaveLength(20);
  });

  it('refuses a cursor that does not move', async () => {
    const { service } = reader([
      json({ has_more: true, next_cursor: 'same', data: [] }),
      json({ has_more: true, next_cursor: 'same', data: [] }),
    ]);
    expect((await failure(service.listLinks())).kind).toBe('unexpected');
  });

  it('never follows a redirect', async () => {
    const { service, calls } = reader([
      new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/v3/links' } }),
    ]);
    expect((await failure(service.listLinks())).kind).toBe('unexpected');
    expect(calls).toHaveLength(1);
  });

  it.each([['127.0.0.1'], ['10.0.0.5'], ['169.254.169.254'], ['::1'], ['fd00::1'], ['::ffff:192.168.1.1']])(
    'calls nothing when the name resolves to %s',
    async (address) => {
      const { service, calls } = reader(
        [json({ ok: true })],
        [...PUBLIC, { address, family: address.includes(':') ? 6 : 4 }],
      );
      expect((await failure(service.ping())).kind).toBe('unavailable');
      expect(calls).toHaveLength(0);
    },
  );

  it('refuses an answer that is too long, announced or not', async () => {
    const big = JSON.stringify({ has_more: false, data: [], pad: 'x'.repeat(1024 * 1024 + 1) });
    const announced = reader([
      json({ ok: true }, { headers: { 'content-length': String(5 * 1024 * 1024) } }),
    ]);
    expect((await failure(announced.service.ping())).kind).toBe('unexpected');
    const silent = reader([new Response(big, { headers: { 'content-type': 'application/json' } })]);
    expect((await failure(silent.service.listLinks())).kind).toBe('unexpected');
  });

  it('refuses an answer that is not JSON', async () => {
    const html = reader([new Response('<html>', { headers: { 'content-type': 'text/html' } })]);
    expect((await failure(html.service.ping())).kind).toBe('unexpected');
    const broken = reader([new Response('{', { headers: { 'content-type': 'application/json' } })]);
    expect((await failure(broken.service.ping())).kind).toBe('unexpected');
  });

  it('tells a refused key, a refused plan, a limit and an outage apart', async () => {
    const error = { type: 'error', code: 'x', message: `secret words about ${ORIGIN}` };
    expect((await failure(reader([json(error, { status: 401 })]).service.ping())).kind).toBe('unauthorized');
    expect((await failure(reader([json(error, { status: 403 })]).service.ping())).kind).toBe('forbidden');
    const limited = await failure(
      reader([json(error, { status: 429, headers: { 'retry-after': '42' } })]).service.ping(),
    );
    expect(limited.kind).toBe('rate_limited');
    expect(limited.retryAfterSeconds).toBe(42);
    expect((await failure(reader([json(error, { status: 503 })]).service.ping())).kind).toBe('unavailable');
  });

  it('never lets the host, the key nor the answer into an error', async () => {
    const errors = [
      await failure(reader([new Error(`getaddrinfo ENOTFOUND liens.example Bearer ${KEY}`)]).service.ping()),
      await failure(
        reader([json({ message: `bad key ${KEY} at ${ORIGIN}` }, { status: 401 })]).service.ping(),
      ),
      await failure(reader([json({ ok: false, host: ORIGIN })]).service.ping()),
    ];
    for (const error of errors) {
      const text = `${error.message} ${String(error.stack)} ${JSON.stringify(error)} ${String(error.cause)}`;
      expect(text).not.toContain('liens.example');
      expect(text).not.toContain(KEY);
    }
    expect(errors[0]?.kind).toBe('unavailable');
  });

  describe('the hours of a link', () => {
    const ref = LinkRefSchema.parse(`lnk_${'0'.repeat(23)}1`);
    const range = { from: new Date('2026-11-16T12:00:00Z'), to: new Date('2026-11-16T15:00:00Z') };
    const series = (data: readonly unknown[]) => json({ object: 'list', data, has_more: false });

    it('reads views then clicks by the hour in UTC, and keeps the hours of the range that have something', async () => {
      const { service, calls } = reader([
        series([
          { bucket: '2026-11-16T11:00:00Z', pageviews: 9, clicks: 9 },
          { bucket: '2026-11-16T12:00:00Z', pageviews: 4, clicks: 4 },
          { bucket: '2026-11-16T13:00:00Z', pageviews: 0, clicks: 0 },
          { bucket: '2026-11-16T14:00:00.000Z', pageviews: 2, clicks: 2 },
          { bucket: '2026-11-16T15:00:00Z', pageviews: 7, clicks: 7 },
        ]),
        series([
          { bucket: '2026-11-16T12:00:00Z', button_clicks: 1 },
          { bucket: '2026-11-16T13:00:00Z', button_clicks: 0 },
          { bucket: '2026-11-16T14:00:00Z', button_clicks: 2 },
        ]),
      ]);
      expect(await service.readHours(ref, range)).toEqual([
        { hour: '2026-11-16T12:00:00.000Z', pageviews: 4, clicks: 1 },
        { hour: '2026-11-16T14:00:00.000Z', pageviews: 2, clicks: 2 },
      ]);
      expect(calls.map((call) => call.url.pathname)).toEqual([
        '/v3/analytics/time-series',
        '/v3/analytics/time-series',
      ]);
      expect(calls.map((call) => call.url.searchParams.get('metric'))).toEqual([
        'pageviews',
        'button_clicks',
      ]);
      for (const call of calls) {
        expect(call.url.searchParams.get('link_id')).toBe(ref);
        expect(call.url.searchParams.get('interval')).toBe('hour');
        expect(call.url.searchParams.get('timezone')).toBe('UTC');
        expect(call.url.searchParams.get('timeframe')).toBe('48h');
      }
    });

    it('counts the robots of each hour, and nothing else of what the service flags', async () => {
      const flagged = (hour: string, bot: number) => ({
        bucket: `2026-11-16T${hour}:00:00.000Z`,
        total: 40,
        blocked: 0,
        clean: 40,
        breakdown: { vpn: 5, datacenter: 3, bot },
      });
      const { service, calls } = reader([
        series([flagged('11', 6), flagged('12', 2), flagged('13', 0), flagged('14', 1)]),
      ]);
      expect(await service.readRobotHours(ref, range)).toEqual([
        { hour: '2026-11-16T12:00:00.000Z', robots: 2 },
        { hour: '2026-11-16T14:00:00.000Z', robots: 1 },
      ]);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url.pathname).toBe('/v3/analytics/shield');
      expect(calls[0]?.url.searchParams.get('interval')).toBe('hour');
    });

    it('never asks for the visitors nor for where they came from', async () => {
      const { service, calls } = reader([series([]), series([]), series([])]);
      await service.readHours(ref, range);
      await service.readRobotHours(ref, range);
      for (const call of calls) expect(call.url.pathname).not.toMatch(/visitor|referr|countr/u);
    });

    it('does not send a reference the service could not have given', async () => {
      const { service, calls } = reader([]);
      const forged = LinkRefSchema.parse('lnk_1&team_id=tm_2');
      expect((await failure(service.readHours(forged, range))).kind).toBe('unexpected');
      expect((await failure(service.readRobotHours(forged, range))).kind).toBe('unexpected');
      expect(calls).toHaveLength(0);
    });

    it('refuses a series that is not by the hour, is paginated, too long or miscounted', async () => {
      const odd = [
        series([{ bucket: '2026-11-16T12:30:00Z', pageviews: 1 }]),
        series([{ bucket: '2026-11-16T12:00:00+01:00', pageviews: 1 }]),
        series([{ bucket: '2026-11-16T12:00:00Z', pageviews: -1 }]),
        series([{ bucket: '2026-11-16T12:00:00Z', pageviews: 1.5 }]),
        series(Array.from({ length: 73 }, () => ({ bucket: '2026-11-16T12:00:00Z', pageviews: 1 }))),
        json({ object: 'list', data: [], has_more: true }),
        json({ data: 'none', has_more: false }),
      ];
      for (const answer of odd) {
        expect((await failure(reader([answer]).service.readHours(ref, range))).kind).toBe('unexpected');
      }
      const robots = reader([series([{ bucket: '2026-11-16T12:00:00Z', total: 3 }])]);
      expect((await failure(robots.service.readRobotHours(ref, range))).kind).toBe('unexpected');
    });

    it('fails whole when the clicks do not come, and says a limit like the rest', async () => {
      const limited = reader([
        series([{ bucket: '2026-11-16T12:00:00Z', pageviews: 4 }]),
        json({ code: 'rate_limited' }, { status: 429, headers: { 'retry-after': '30' } }),
      ]);
      const error = await failure(limited.service.readHours(ref, range));
      expect(error.kind).toBe('rate_limited');
      expect(error.retryAfterSeconds).toBe(30);
      const missing = reader([json({ code: 'link_not_found' }, { status: 404 })]);
      expect((await failure(missing.service.readRobotHours(ref, range))).kind).toBe('unexpected');
    });
  });
});
