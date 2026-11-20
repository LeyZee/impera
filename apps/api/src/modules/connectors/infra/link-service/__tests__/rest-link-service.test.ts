import { describe, expect, it } from 'vitest';

import type { Pinned } from '../../avatar/fetch-avatar';
import { createLinkServiceReader, LinkServiceError } from '../rest-link-service';

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
});
