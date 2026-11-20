import { DomainError } from '@impera/contracts';
import { close, createTransport, isInitialized, type ErrorEvent, type NodeOptions } from '@sentry/node';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLogger } from '../logger';
import {
  framesOfBrowserStack,
  INERT_ERROR_REPORTER,
  startErrorReporting,
  type ErrorReporter,
} from '../observability/error-reporter';
import { maskQuoted, scrubEvent, scrubText } from '../observability/scrub';
import { buildServer } from '../server';

import { testConfig } from './support/config';

/**
 * OPS-18: what leaves for Sentry. Every value below is invented (ADR 0010); the DSN points at a `.test` host, and the
 * transport is a fake that keeps the envelopes Sentry would have sent, so that each test reads them whole.
 */
const DSN = 'https://publickey@errors.example.test/42';
const FAN_MESSAGE = 'viens dans mon lit ce soir, je te paie le double';
const EMAIL = 'fan.secret@example.test';
const COOKIE = 'impera.session_token=abcdefabcdefabcdefabcdefabcdefabcdef';
const ORIGIN = 'http://localhost:5173';

/** Starts Sentry on a transport that keeps what it would send; `close` is called after each test. */
function reporterWithFakeTransport(): { readonly reporter: ErrorReporter; readonly sent: string[] } {
  const sent: string[] = [];
  const transport: NodeOptions['transport'] = (options) =>
    createTransport(options, (request) => {
      sent.push(typeof request.body === 'string' ? request.body : new TextDecoder().decode(request.body));
      return Promise.resolve({ statusCode: 200 });
    });
  const reporter = startErrorReporting(
    { SENTRY_DSN: DSN, RELEASE: 'abc123', NODE_ENV: 'production' },
    { transport },
  );
  return { reporter, sent };
}

const EnvelopeEventSchema = z
  .object({
    exception: z.object({ values: z.array(z.object({ type: z.string(), value: z.string() }).loose()) }),
  })
  .loose();

/** The events of the envelopes sent: the items whose header says `event`. */
function eventsOf(sent: readonly string[]): unknown[] {
  return sent.flatMap((envelope) => {
    const lines = envelope.split('\n');
    const events: unknown[] = [];
    for (let index = 1; index < lines.length - 1; index += 2) {
      const header: unknown = JSON.parse(lines[index] ?? '{}');
      if (
        z
          .object({ type: z.literal('event') })
          .loose()
          .safeParse(header).success
      ) {
        events.push(JSON.parse(lines[index + 1] ?? '{}'));
      }
    }
    return events;
  });
}

afterEach(async () => {
  await close(1_000);
});

describe('scrubText (OPS-18)', () => {
  it('drops what looks like an e-mail, an address, a bearer token, an opaque token or a long run of digits', () => {
    const text = scrubText(
      `send to ${EMAIL} at https://crm.example.test/fans/1?token=x with Bearer eyJabc.def.ghi, key xai-${'a'.repeat(40)}, iban 76300040000123`,
    );
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain('crm.example.test');
    expect(text).not.toContain('eyJabc');
    expect(text).not.toContain('a'.repeat(40));
    expect(text).not.toContain('76300040000123');
    expect(text).toContain('[email]');
    expect(text).toContain('[url]');
    expect(text).toContain('Bearer [token]');
    expect(text).toContain('[number]');
  });

  it('keeps our own ids whole, and cuts to one line of 300 characters', () => {
    const id = '0193a1b2-c3d4-7e5f-8a9b-123456789012';
    expect(scrubText(`fan ${id} not found`)).toBe(`fan ${id} not found`);
    const long = scrubText(`${'mot '.repeat(200)}\nsecond line`);
    expect(long.length).toBe(300);
    expect(long).not.toContain('\n');
  });
});

describe('scrubEvent (OPS-18)', () => {
  const full: ErrorEvent = {
    type: undefined,
    event_id: 'e1',
    level: 'error',
    release: 'abc123',
    environment: 'production',
    server_name: 'impera-host-7',
    message: FAN_MESSAGE,
    transaction: `POST /v1/fans/1?email=${EMAIL}`,
    exception: {
      values: [
        {
          type: 'TypeError',
          value: `cannot read reply of ${EMAIL}`,
          mechanism: { type: 'generic', handled: true },
          stacktrace: {
            frames: [
              {
                filename: '/home/someone/impera/apps/api/src/server.ts',
                abs_path: '/home/someone/impera/apps/api/src/server.ts',
                function: 'handler',
                lineno: 10,
                colno: 3,
                in_app: true,
                vars: { text: FAN_MESSAGE },
                context_line: `const text = '${FAN_MESSAGE}'`,
              },
            ],
          },
        },
      ],
    },
    request: {
      method: 'POST',
      url: `https://crm.example.test/v1/fans/1?email=${EMAIL}`,
      query_string: `email=${EMAIL}`,
      cookies: { session: COOKIE },
      headers: { cookie: COOKIE },
      data: { text: FAN_MESSAGE },
    },
    user: { id: 'u1', email: EMAIL, ip_address: '203.0.113.9' },
    extra: { body: FAN_MESSAGE },
    breadcrumbs: [{ message: FAN_MESSAGE }],
    tags: { service: 'api', route: '/v1/fans/:fanId', creatorName: 'Messa', attempt: 2 },
    contexts: {
      runtime: { name: 'node', version: 'v22.23.4' },
      os: { name: 'Linux', version: '6.1', kernel_version: 'impera-host-7' },
      app: { app_memory: 1 },
      trace: { trace_id: 't', span_id: 's' },
    },
    modules: { pg: '8.0.0' },
  };

  it('keeps only the error, the release, the allowed tags, the runtime and the system', () => {
    const clean = scrubEvent(full);
    const written = JSON.stringify(clean);
    for (const secret of [FAN_MESSAGE, EMAIL, COOKIE, 'impera-host-7', 'someone', '203.0.113.9', 'Messa']) {
      expect(written).not.toContain(secret);
    }
    expect(clean).toEqual({
      type: undefined,
      event_id: 'e1',
      level: 'error',
      release: 'abc123',
      environment: 'production',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'cannot read reply of [email]',
            mechanism: { type: 'generic', handled: true },
            stacktrace: {
              frames: [
                {
                  filename: 'apps/api/src/server.ts',
                  function: 'handler',
                  lineno: 10,
                  colno: 3,
                  in_app: true,
                },
              ],
            },
          },
        ],
      },
      tags: { service: 'api', route: '/v1/fans/:fanId', attempt: '2' },
      contexts: { runtime: { name: 'node', version: 'v22.23.4' }, os: { name: 'Linux', version: '6.1' } },
      request: { method: 'POST' },
    });
  });

  it('keeps the request’s address only when it is the route’s template', () => {
    const clean = scrubEvent({ ...full, request: { method: 'GET', url: '/v1/fans/:fanId' } });
    expect(clean?.request).toEqual({ method: 'GET', url: '/v1/fans/:fanId' });
  });

  it('drops an event without an error, and one that cannot be rebuilt', () => {
    expect(scrubEvent({ type: undefined, message: FAN_MESSAGE })).toBeNull();
    const broken: ErrorEvent = { type: undefined };
    Object.defineProperty(broken, 'exception', {
      get: () => {
        throw new Error('unreadable');
      },
    });
    expect(scrubEvent(broken)).toBeNull();
  });
});

describe('startErrorReporting (OPS-18)', () => {
  it('stays inert without a DSN: no client, no network', async () => {
    const reporter = startErrorReporting({ SENTRY_DSN: undefined, RELEASE: 'dev', NODE_ENV: 'development' });
    expect(reporter).toBe(INERT_ERROR_REPORTER);
    expect(reporter.isEnabled).toBe(false);
    reporter.captureException(new Error('nothing leaves'), { service: 'api' });
    await reporter.flush(100);
    expect(isInitialized()).toBe(false);
  });

  it('never sends the body, the query nor the headers of the request that failed, and only its 5xx', async () => {
    const { reporter, sent } = reporterWithFakeTransport();
    const config = testConfig({ SENTRY_DSN: DSN });
    const routes: FastifyPluginAsyncZod = (app) => {
      app.post('/boom/:fanId', () => {
        throw new TypeError(`reply to ${EMAIL} failed`);
      });
      app.post('/missing/:fanId', () => {
        throw new DomainError('fan_not_found', 'Fan introuvable');
      });
      return Promise.resolve();
    };
    const server = await buildServer({
      config,
      logger: createLogger(config),
      routes: [routes],
      readiness: () =>
        Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
      errorReporter: reporter,
    });
    const asked = {
      method: 'POST' as const,
      query: { email: EMAIL, text: FAN_MESSAGE },
      headers: {
        origin: ORIGIN,
        cookie: COOKIE,
        'x-fan-note': FAN_MESSAGE,
        authorization: `Bearer ${COOKIE}`,
      },
      payload: { text: FAN_MESSAGE, email: EMAIL },
    };
    const failed = await server.inject({ ...asked, url: '/v1/boom/0193a1b2-c3d4-7e5f-8a9b-123456789012' });
    const missing = await server.inject({
      ...asked,
      url: '/v1/missing/0193a1b2-c3d4-7e5f-8a9b-123456789012',
    });
    await reporter.flush(2_000);
    await server.close();

    expect(failed.statusCode).toBe(500);
    expect(missing.statusCode).toBe(404);
    const everything = sent.join('\n');
    for (const secret of [FAN_MESSAGE, EMAIL, COOKIE, 'x-fan-note', 'localhost']) {
      expect(everything).not.toContain(secret);
    }
    const events = eventsOf(sent);
    // The 500 only: a 4xx is the client's.
    expect(events).toHaveLength(1);
    const event = EnvelopeEventSchema.parse(events[0]);
    expect(event.exception.values[0]).toMatchObject({ type: 'TypeError', value: 'reply to [email] failed' });
    expect(event).toMatchObject({
      release: 'abc123',
      environment: 'production',
      tags: { service: 'api', route: '/v1/boom/:fanId' },
      request: { method: 'POST', url: '/v1/boom/:fanId' },
    });
    expect(Object.keys(event).sort()).toEqual(
      [
        'contexts',
        'environment',
        'event_id',
        'exception',
        'level',
        'platform',
        'release',
        'request',
        'sdk',
        'tags',
        'timestamp',
      ].sort(),
    );
  });

  it('sends a failed job by its task and its attempt', async () => {
    const { reporter, sent } = reporterWithFakeTransport();
    reporter.captureException(new Error('provider timed out'), {
      service: 'worker',
      task: 'conversation.generate_draft',
      attempt: 2,
    });
    await reporter.flush(2_000);
    expect(eventsOf(sent)).toEqual([
      expect.objectContaining({
        tags: { service: 'worker', task: 'conversation.generate_draft', attempt: '2' },
      }),
    ]);
  });

  it('sends the dashboard’s report tagged web, its frames without their address’s origin nor query', async () => {
    const { reporter, sent } = reporterWithFakeTransport();
    reporter.captureClientError({
      message: `TypeError: cannot read draft of ${EMAIL}`,
      stack: [
        `TypeError: cannot read draft of ${EMAIL}`,
        '    at renderDraft (https://crm.example.test/assets/index-3f2a.js?v=1:12:345)',
        '    at https://crm.example.test/assets/vendor-9c1d.js:1:2',
      ].join('\n'),
      route: '/equipe/$memberId',
      release: 'web-777',
    });
    await reporter.flush(2_000);
    const everything = sent.join('\n');
    expect(everything).not.toContain(EMAIL);
    expect(everything).not.toContain('crm.example.test');
    expect(eventsOf(sent)).toEqual([
      expect.objectContaining({
        // The API's release, never the browser's: that one is a tag.
        release: 'abc123',
        tags: { service: 'web', route: '/equipe/$memberId', web_release: 'web-777' },
        exception: {
          values: [
            {
              type: 'TypeError',
              value: 'cannot read draft of [email]',
              mechanism: { type: 'onerror', handled: false },
              stacktrace: {
                frames: [
                  { filename: 'assets/vendor-9c1d.js', function: '?', lineno: 1, colno: 2, in_app: true },
                  {
                    filename: 'assets/index-3f2a.js',
                    function: 'renderDraft',
                    lineno: 12,
                    colno: 345,
                    in_app: true,
                  },
                ],
              },
            },
          ],
        },
      }),
    ]);
  });
});

/** An invented fan sentence (ADR 0010), of words found nowhere else in an envelope. */
const FAN_SENTENCE = 'Zorblax adore tes chaussettes violettes';
const FAN_WORDS = FAN_SENTENCE.split(' ').filter((word) => word.length >= 4);

/** The error `JSON.parse` throws on that sentence: it quotes the sentence's start. */
function parseErrorOf(text: string): Error {
  try {
    JSON.parse(text);
  } catch (error) {
    if (error instanceof Error) return error;
  }
  throw new Error('JSON.parse accepted the sentence');
}

describe('maskQuoted (Sécurité on #895)', () => {
  it('masks what an error quotes, but one identifier', () => {
    expect(maskQuoted("Cannot read properties of undefined (reading 'foo')")).toBe(
      "Cannot read properties of undefined (reading 'foo')",
    );
    expect(maskQuoted(parseErrorOf(FAN_SENTENCE).message)).toBe(
      `Unexpected token 'Z', "[texte]"... is not valid JSON`,
    );
    const pairs: readonly (readonly [string, string])[] = [
      ['"', '"'],
      ['`', '`'],
      ['«', '»'],
      ['“', '”'],
      ['‘', '’'],
      ["'", "'"],
    ];
    for (const [open, close] of pairs) {
      expect(maskQuoted(`refusé : ${open}viens ce soir${close} !`)).toBe(`refusé : ${open}[texte]${close} !`);
    }
  });

  it('masks to the end a quote never closed, and leaves an apostrophe inside a word', () => {
    expect(maskQuoted('Unterminated string "viens dans mon lit')).toBe('Unterminated string "[texte]');
    expect(maskQuoted("l'élément est introuvable")).toBe("l'élément est introuvable");
  });

  it('closes an apostrophe segment only where no letter or digit follows, as French writes (Sécurité on cf32be38)', () => {
    expect(maskQuoted("received 'je t'aime fort' from the model")).toBe("received '[texte]' from the model");
    expect(maskQuoted('received ‘j’ai envie de toi’ from the model')).toBe(
      'received ‘[texte]’ from the model',
    );
    expect(maskQuoted("received 'aujourd'hui'")).toBe("received '[texte]'");
    expect(maskQuoted("received 'je t'aime fort")).toBe("received '[texte]");
    expect(maskQuoted("unknown option 'foo'")).toBe("unknown option 'foo'");
    expect(maskQuoted("Cannot read properties of null (reading 'x')")).toBe(
      "Cannot read properties of null (reading 'x')",
    );
  });

  it('masks the value of a Postgres duplicate key', () => {
    expect(
      maskQuoted(
        'duplicate key value violates unique constraint "fans_pseudo_key" Key (pseudo)=(Zorblax adore) already exists.',
      ),
    ).toBe(
      'duplicate key value violates unique constraint "fans_pseudo_key" Key (pseudo)=([texte]) already exists.',
    );
  });

  it('stays linear on 10 000 hostile characters', () => {
    const hostile = [
      'a'.repeat(10_000),
      '"'.repeat(10_000),
      `'a`.repeat(5_000),
      `'a'b`.repeat(2_500),
      `‘a’b`.repeat(2_500),
      '=('.repeat(5_000),
      'x@'.repeat(5_000),
      'http'.repeat(2_500),
      `${'a'.repeat(31)} `.repeat(312),
      '1:'.repeat(5_000),
      ' ('.repeat(5_000),
    ];
    const started = performance.now();
    for (const text of hostile) {
      scrubText(maskQuoted(text));
      framesOfBrowserStack(text.slice(0, 4_000));
      framesOfBrowserStack(`at ${text.slice(0, 4_000)})`);
    }
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe('a fan sentence quoted by an error (Sécurité on #895)', () => {
  it('sends none of its words from a job', async () => {
    const { reporter, sent } = reporterWithFakeTransport();
    reporter.captureException(parseErrorOf(FAN_SENTENCE), {
      service: 'worker',
      task: 'conversation.generate_draft',
      attempt: 1,
    });
    await reporter.flush(2_000);
    expect(eventsOf(sent)).toHaveLength(1);
    const everything = sent.join('\n');
    for (const word of [...FAN_WORDS, 'Zorblax ad']) expect(everything).not.toContain(word);
    expect(everything).toContain('[texte]');
  });

  it('sends none of its words from the dashboard', async () => {
    const { reporter, sent } = reporterWithFakeTransport();
    const message = `SyntaxError: ${parseErrorOf(FAN_SENTENCE).message}`;
    reporter.captureClientError({
      message,
      stack: `${message}\n    at readDraft (https://crm.example.test/assets/index-3f2a.js:12:345)`,
      route: '/conversations/$conversationId',
      release: 'web-777',
    });
    await reporter.flush(2_000);
    expect(eventsOf(sent)).toHaveLength(1);
    const everything = sent.join('\n');
    for (const word of [...FAN_WORDS, 'Zorblax ad']) expect(everything).not.toContain(word);
    expect(everything).toContain('[texte]');
  });
});

describe('framesOfBrowserStack', () => {
  it('reads Chrome’s and Firefox’s lines, oldest first, and skips the rest', () => {
    expect(
      framesOfBrowserStack(
        [
          'Error: boom',
          'inner@https://a.example.test/assets/x.js:3:4',
          '    at outer (https://a.example.test/assets/y.js:5:6)',
        ].join('\n'),
      ),
    ).toEqual([
      {
        filename: 'https://a.example.test/assets/y.js',
        function: 'outer',
        lineno: 5,
        colno: 6,
        in_app: true,
      },
      {
        filename: 'https://a.example.test/assets/x.js',
        function: 'inner',
        lineno: 3,
        colno: 4,
        in_app: true,
      },
    ]);
  });
});
