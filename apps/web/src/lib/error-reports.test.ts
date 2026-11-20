// @vitest-environment jsdom
import { ClientErrorReportSchema } from '@impera/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { forgetSentReports, listenForErrors, reportError, reportOf } from './error-reports';

afterEach(() => {
  forgetSentReports();
  vi.unstubAllGlobals();
});

const SentSchema = z.object({ message: z.string(), route: z.string() }).loose();

/** What a call sent, read back. */
const sentOf = (init: RequestInit | undefined) =>
  SentSchema.parse(JSON.parse(typeof init?.body === 'string' ? init.body : '{}'));

/** An event of the page with its error or its reason, as the browser gives them. */
function pageEvent(type: 'error' | 'unhandledrejection', field: 'error' | 'reason', value: unknown): Event {
  const event = new Event(type);
  Object.defineProperty(event, field, { value });
  return event;
}

/** A fake `fetch` that keeps what each call sent and answers 204. */
function fakeSend() {
  const calls: { readonly url: string; readonly init: RequestInit | undefined }[] = [];
  const send: typeof fetch = (input, init) => {
    calls.push({ url: input instanceof Request ? input.url : input.toString(), init });
    return Promise.resolve(new Response(null, { status: 204 }));
  };
  return { calls, send };
}

describe('the dashboard’s error reports (OPS-18)', () => {
  it('says the error’s name and message, its stack, the route’s template and the release, cut to their bounds', () => {
    const error = new TypeError('x'.repeat(500));
    const report = reportOf(error, '/equipe/$memberId');
    expect(report).toMatchObject({ route: '/equipe/$memberId', release: 'dev' });
    expect(report?.message.startsWith('TypeError: xxx')).toBe(true);
    expect(report?.message).toHaveLength(300);
    expect(ClientErrorReportSchema.safeParse(report).success).toBe(true);
  });

  it('never sends an address in place of a template, and says nothing of a hidden error', () => {
    expect(reportOf(new Error('boom'), '/fans?email=fan@example.test')?.route).toBe('/');
    expect(reportOf(new Error('boom'), undefined)?.route).toBe('/');
    expect(reportOf('Script error.', '/')).toBeNull();
  });

  it('posts to the API on its own origin, each error once, five per page at most', () => {
    const { calls, send } = fakeSend();
    reportError(new Error('first'), '/', send);
    reportError(new Error('first'), '/', send);
    for (let index = 0; index < 10; index += 1) reportError(new Error(`other ${String(index)}`), '/', send);
    expect(calls).toHaveLength(5);
    expect(calls[0]?.url).toBe('/v1/client-errors');
    expect(calls[0]?.init).toMatchObject({ method: 'POST', credentials: 'same-origin' });
    expect(sentOf(calls[0]?.init)).toMatchObject({ message: 'Error: first', route: '/' });
  });

  it('listens to the page’s errors and rejections until told to stop', () => {
    const { calls, send } = fakeSend();
    vi.stubGlobal('fetch', send);
    // A page of its own: the test runner listens to the window's errors.
    const page = new EventTarget();
    const stop = listenForErrors(() => '/planning', page);
    page.dispatchEvent(pageEvent('error', 'error', new RangeError('Invalid time value')));
    page.dispatchEvent(pageEvent('unhandledrejection', 'reason', new Error('nobody awaited')));
    stop();
    page.dispatchEvent(pageEvent('error', 'error', new Error('after the end')));
    expect(calls.map((call) => sentOf(call.init))).toEqual([
      expect.objectContaining({ message: 'RangeError: Invalid time value', route: '/planning' }),
      expect.objectContaining({ message: 'Error: nobody awaited', route: '/planning' }),
    ]);
  });
});
