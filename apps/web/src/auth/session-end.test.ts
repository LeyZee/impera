// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { endsSession, watchSessionEnd } from './session-end';

const error = (code: string, status = 401) =>
  Response.json({ error: { code, message: 'x', details: {}, requestId: 'r' } }, { status });

// Recette 05/11, SEC-01: a session closed elsewhere answers 401 to the next call, whatever the screen.
describe('the end of a session, seen in the answers of /v1', () => {
  it('reads a missing session in a 401 of any screen, even one without our error body', async () => {
    expect(await endsSession('/v1/payroll/periods', error('session_unauthenticated'))).toBe(true);
    expect(await endsSession('/v1/payroll/periods', new Response('', { status: 401 }))).toBe(true);
    expect(await endsSession('/v1/auth/sessions', error('session_unauthenticated'))).toBe(true);
  });

  it('leaves a wrong password or a wrong code where it belongs, on the confirmation that asked for it', async () => {
    expect(await endsSession('/v1/auth/reauthenticate', error('reauthentication_unauthenticated'))).toBe(
      false,
    );
    expect(await endsSession('/v1/auth/two-factor/enable', error('password_unauthenticated'))).toBe(false);
    expect(await endsSession('/v1/auth/reauthenticate', new Response('', { status: 401 }))).toBe(false);
    expect(await endsSession('/v1/payroll/periods', error('role_forbidden', 403))).toBe(false);
    expect(await endsSession('/elsewhere', new Response('', { status: 401 }))).toBe(false);
  });

  it('tells the app, hands the screen its answer unchanged, and puts fetch back', async () => {
    const browserFetch = vi.fn(function (this: unknown, input: RequestInfo | URL) {
      // The browser's fetch refuses to run on anything but its window.
      if (this !== target) throw new TypeError('Illegal invocation');
      return Promise.resolve(
        (input instanceof URL ? input.href : typeof input === 'string' ? input : input.url).includes(
          'periods',
        )
          ? error('session_unauthenticated')
          : Response.json({ ok: true }),
      );
    });
    const target: Pick<Window, 'fetch'> = { fetch: browserFetch };
    const onEnded = vi.fn();
    const unwatch = watchSessionEnd(onEnded, target);

    const fine = await target.fetch('/v1/creators');
    expect(await fine.json()).toEqual({ ok: true });
    const refused = await target.fetch(new URL('http://localhost/v1/payroll/periods'));
    expect(refused.status).toBe(401);
    // The screen still reads the body the watcher looked at.
    expect(await refused.json()).toMatchObject({ error: { code: 'session_unauthenticated' } });
    await vi.waitFor(() => {
      expect(onEnded).toHaveBeenCalledTimes(1);
    });

    unwatch();
    expect(target.fetch).toBe(browserFetch);
  });
});
