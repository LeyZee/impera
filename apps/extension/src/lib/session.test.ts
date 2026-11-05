import { describe, expect, it, vi } from 'vitest';

import { readCrmSession, type Fetch } from './session';

const ME = {
  id: 'u1',
  email: 'alex@exemple.fr',
  name: 'Alex Morel',
  role: 'owner',
  creatorIds: [],
  routedCreatorIds: [],
  team: null,
  teamScope: 'owner',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const apiError = (code: string) => ({ error: { code, message: 'x', details: {}, requestId: 'r' } });

describe('readCrmSession', () => {
  it('asks /v1/me with the browser cookie, never a token of its own', async () => {
    const fetchFn = vi.fn<Fetch>().mockResolvedValue(json(200, ME));
    const session = await readCrmSession('http://localhost:5173', fetchFn);
    expect(session).toMatchObject({ kind: 'signed_in', me: { name: 'Alex Morel' } });
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('http://localhost:5173/v1/me');
    expect(init?.credentials).toBe('include');
    expect(init?.method ?? 'GET').toBe('GET');
    expect(JSON.stringify(init?.headers)).not.toMatch(/token|authorization/iu);
  });

  it('is signed out on a 401', async () => {
    const session = await readCrmSession('http://localhost:5173', () => Promise.resolve(json(401, {})));
    expect(session).toEqual({ kind: 'signed_out' });
  });

  it('sends an account without its code to the CRM', async () => {
    const answer = json(403, apiError('second_factor_forbidden'));
    expect(await readCrmSession('http://localhost:5173', () => Promise.resolve(answer))).toEqual({
      kind: 'second_factor_required',
    });
  });

  it.each([
    ['no answer', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a server error that is not a gateway', () => Promise.resolve(json(500, {}))],
    ['another 403', () => Promise.resolve(json(403, apiError('origin_forbidden')))],
    ['an answer that is not the contract', () => Promise.resolve(json(200, { hello: 'world' }))],
    ['a page that is not JSON', () => Promise.resolve(new Response('<html>', { status: 200 }))],
  ])('is unreachable on %s', async (_, fetchFn: Fetch) => {
    expect(await readCrmSession('http://localhost:5173', fetchFn)).toEqual({ kind: 'unreachable' });
  });

  it.each([502, 503, 504])('tells a CRM whose API is down (%i) from a wrong address', async (status) => {
    const answer = new Response('<html>Bad Gateway</html>', { status });
    expect(await readCrmSession('http://localhost:5173', () => Promise.resolve(answer))).toEqual({
      kind: 'server_down',
    });
  });
});
