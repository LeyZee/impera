import { ConnectorConfigSchema, CreatorIdSchema, PlatformAccountIdSchema } from '@impera/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { createFakeReveal, type FakeReveal } from '../../../../../__tests__/fake-reveal/server';
import { ConnectorError } from '../../../domain/platform-connector';
import type { RevealCallLog, RevealFetch } from '../client';
import { RevealApiConnector, revealApiConnectors } from '../connector';
import type { RevealSession } from '../session';

/**
 * `RevealApiConnector` against FakeReveal's default world (fake-reveal.md § Fixtures): 12 fans, a conversation of 320
 * messages, 4 sequences of 3 steps (sequence 1 sent whole to fan 02, two steps bought; sequence 2 up to step 2 to
 * fan 03), 15 media in 3 vault folders (`☀️`, `🌙`, none). Everything is invented.
 */

const BASE = 'https://reveal.test';
const USER_AGENT = 'Mozilla/5.0 (test)';

let fakes: FakeReveal[] = [];
afterEach(async () => {
  await Promise.all(fakes.map((fake) => fake.app.close()));
  fakes = [];
});

function world(fixture: 'default' | 'quiet' = 'default'): FakeReveal {
  const fake = createFakeReveal({ fixture });
  fakes.push(fake);
  return fake;
}

function sessionOf(fake: FakeReveal, bearer = fake.authorization.slice('Bearer '.length)): RevealSession {
  return {
    v: 1,
    bearer,
    userId: fake.userId,
    modelId: fake.modelId,
    userAgent: USER_AGENT,
    capturedAt: '2026-10-01T00:00:00.000Z',
  };
}

function connect(
  fake: FakeReveal,
  extra: { log?: (entry: RevealCallLog) => void; fetch?: RevealFetch; now?: () => Date } = {},
): RevealApiConnector {
  return new RevealApiConnector({
    session: sessionOf(fake),
    fetch: extra.fetch ?? fake.fetch,
    baseUrl: BASE,
    sleep: () => Promise.resolve(),
    ...(extra.log === undefined ? {} : { log: extra.log }),
    ...(extra.now === undefined ? {} : { now: extra.now }),
  });
}

const fan = (id: string) => ({ platform: 'reveal' as const, id });

async function scenario(fake: FakeReveal, events: object[]): Promise<void> {
  const response = await fake.app.inject({ method: 'POST', url: '/__scenario', payload: { events } });
  expect(response.statusCode).toBe(200);
}

async function rejection(promise: Promise<unknown>): Promise<ConnectorError> {
  const error: unknown = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ConnectorError)) throw new Error(`expected a ConnectorError, got ${String(error)}`);
  return error;
}

describe('RevealApiConnector: the client (spec § 3)', () => {
  it('sends the session’s bearer and user agent, the dashboard’s origin, nothing else', async () => {
    const fake = world();
    const seen: Record<string, string>[] = [];
    const spy: RevealFetch = (url, init) => {
      seen.push(init.headers);
      return fake.fetch(url, init);
    };
    expect(await connect(fake, { fetch: spy }).health()).toBe('valid');
    expect(seen).toEqual([
      {
        authorization: fake.authorization,
        'user-agent': USER_AGENT,
        origin: 'https://dashboard.reveal.me',
        referer: 'https://dashboard.reveal.me/',
      },
    ]);
  });

  it('waits for a window’s reset once less than 20 % of it is left', async () => {
    const fake = world();
    const waits: number[] = [];
    const low: RevealFetch = async (url, init) => {
      const answer = await fake.fetch(url, init);
      return {
        ...answer,
        headers: {
          get: (name) =>
            ({
              'x-ratelimit-limit-medium': '100',
              'x-ratelimit-remaining-medium': '19',
              'x-ratelimit-reset-medium': '10',
            })[name] ?? answer.headers.get(name),
        },
      };
    };
    const connector = new RevealApiConnector({
      session: sessionOf(fake),
      fetch: low,
      baseUrl: BASE,
      now: () => new Date('2026-10-03T00:00:00.000Z'),
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    });
    await connector.health();
    expect(waits).toEqual([]);
    await connector.health();
    expect(waits).toEqual([10_000]);
  });

  it('maps every failure to a typed error: rate limit, server error, challenge page, network', async () => {
    const fake = world();
    const connector = connect(fake);
    await scenario(fake, [{ type: 'rate_limited', requests: 1, retryAfterSeconds: 7 }]);
    const limited = await rejection(connector.listConversations({}));
    expect([limited.code, limited.retryAfterSeconds]).toEqual(['rate_limited', 7]);
    await scenario(fake, [{ type: 'server_error', times: 1, status: 503 }]);
    expect((await rejection(connector.listConversations({}))).code).toBe('transient');
    await scenario(fake, [{ type: 'challenge', times: 1 }]);
    const challenge = await rejection(connector.health());
    expect([challenge.code, challenge.message]).toEqual([
      'fatal',
      'challenge: models.get answered a page instead of JSON',
    ]);
    const offline = connect(fake, { fetch: () => Promise.reject(new Error('ECONNRESET')) });
    expect((await rejection(offline.listConversations({}))).code).toBe('transient');
  });

  it('refuses an answer whose shape changed, naming the route and the path, never a value', async () => {
    const fake = world();
    await scenario(fake, [
      { type: 'shape_changed', endpoint: 'messages.list', rename: { from: 'data', to: 'items' } },
    ]);
    const error = await rejection(connect(fake).fetchMessages(fan('conv_02'), {}));
    expect(error.code).toBe('fatal');
    expect(error.message).toBe('shape_changed: messages.list (data, (root))');
  });

  it('never logs the token, a URL or an identifier, even when every call fails', async () => {
    const fake = world();
    const logged: RevealCallLog[] = [];
    const connector = connect(fake, { log: (entry) => logged.push(entry) });
    await connector.listConversations({});
    await connector.fetchMessages(fan('conv_02'), {});
    await scenario(fake, [
      { type: 'shape_changed', endpoint: 'models.get', rename: { from: 'id', to: 'uid' } },
    ]);
    const errors = [await rejection(connector.getCreatorNotes())];
    await scenario(fake, [{ type: 'session_expired' }]);
    errors.push(await rejection(connector.listConversations({})));
    expect(logged.map((entry) => Object.keys(entry).sort())).toEqual(
      logged.map(() => ['ms', 'route', 'status']),
    );
    const text = JSON.stringify([logged, errors.map((error) => [error.message, String(error.cause)])]);
    const bearer = fake.authorization.slice('Bearer '.length);
    for (const secret of [bearer, fake.modelId, 'conv_02', BASE]) expect(text).not.toContain(secret);
    expect(logged.map((entry) => entry.route)).toContain('messages.list');
  });

  it('reads a JWT’s expiry: `warning` a day before it, `expired` once Reveal refuses it', async () => {
    const fake = world();
    const exp = Date.parse('2026-10-03T12:00:00.000Z') / 1_000;
    const jwt = ['e30', Buffer.from(JSON.stringify({ exp })).toString('base64url'), 'signature'].join('.');
    // FakeReveal takes its own token only: the JWT is swapped for it on the way.
    const swap: RevealFetch = (url, init) =>
      fake.fetch(url, { ...init, headers: { ...init.headers, authorization: fake.authorization } });
    const at = (iso: string) =>
      new RevealApiConnector({
        session: sessionOf(fake, jwt),
        fetch: swap,
        baseUrl: BASE,
        now: () => new Date(iso),
      });
    expect(await at('2026-10-02T00:00:00.000Z').health()).toBe('valid');
    expect(await at('2026-10-03T00:00:00.000Z').health()).toBe('warning');
    await scenario(fake, [{ type: 'session_expired' }]);
    expect(await at('2026-10-03T00:00:00.000Z').health()).toBe('expired');
  });

  it('without a session, says `none` and calls nobody', async () => {
    const calls: string[] = [];
    const factory = revealApiConnectors({
      fetch: (url) => {
        calls.push(url);
        return Promise.reject(new Error('no call expected'));
      },
    });
    const account = {
      id: PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000aa'),
      creatorId: CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000bb'),
      platform: 'reveal' as const,
      sessionState: 'valid' as const,
      lastPollAt: null,
      config: ConnectorConfigSchema.parse({}),
      consecutiveErrors: 0,
      pausedUntil: null,
    };
    for (const session of [null, '{"v":2}']) {
      const connector = factory(account, session);
      expect(await connector.health()).toBe('none');
      expect((await rejection(connector.listConversations({}))).code).toBe('session_expired');
    }
    expect(calls).toEqual([]);
  });
});

describe('RevealApiConnector: reading (spec §§ 4, 6)', () => {
  it('reads a whole history across pages, oldest first, or its newest messages only', async () => {
    const connector = connect(world());
    const all = await connector.fetchMessages(fan('conv_01'), {});
    expect(all).toHaveLength(320);
    expect([all[0]?.text, all.at(-1)?.text]).toEqual(['Message de test 1', 'Message de test 320']);
    expect(all.filter((m) => m.direction === 'inbound')).toHaveLength(160);
    const last = await connector.fetchMessages(fan('conv_01'), { limit: 15 });
    expect(last.map((m) => m.text)).toEqual(all.slice(-15).map((m) => m.text));
  });

  it('lists conversations, most recent first, with `since` and `limit`', async () => {
    const connector = connect(world());
    const all = await connector.listConversations({});
    expect(all).toHaveLength(12);
    const dates = all.flatMap((c) => (c.lastMessageAt === null ? [] : [c.lastMessageAt]));
    expect(dates).toEqual([...dates].sort().reverse());
    expect(await connector.listConversations({ limit: 3 })).toHaveLength(3);
    const since = new Date(dates[2] ?? 0);
    expect((await connector.listConversations({ since })).map((c) => c.lastMessageAt)).toEqual(
      dates.slice(0, 2),
    );
  });

  it('reads the fan beside his conversation: profile, note, the model’s notes, PPV tab', async () => {
    const connector = connect(world());
    await connector.listConversations({});
    expect(await connector.getFanProfile(fan('fan_02'))).toMatchObject({
      fanRef: { id: 'fan_02' },
      totalSpentMinor: 2_000,
      currency: 'EUR',
      cardVerifiedAt: null,
    });
    expect((await connector.getFanProfile(fan('fan_01'))).cardVerifiedAt).not.toBeNull();
    expect((await connector.getFanNote(fan('fan_02'))).text).toContain('Prénom : Prénom02');
    expect(await connector.getFanNote(fan('fan_01'))).toEqual({ text: '' });
    expect(await connector.getCreatorNotes()).toEqual([{ text: 'Note du modèle de test' }]);
    const ppv = await connector.getFanPpvStats(fan('fan_02'));
    expect(ppv).toMatchObject({ purchased: 2, offered: 3, highestPriceMinor: 3_000, lowestPriceMinor: 500 });
    expect(ppv.bundles.map((b) => [b.priceMinor, b.isPaid])).toEqual([
      [3_000, false],
      [1_500, true],
      [500, true],
    ]);
  });

  it('finds an unlisted fan by reading the list again, and fails `not_found` for a fan it does not have', async () => {
    const connector = connect(world());
    expect((await connector.getFanNote(fan('fan_02'))).text).not.toBe('');
    expect((await rejection(connector.getFanNote(fan('fan_inconnu')))).code).toBe('not_found');
  });

  it('lists scripts: a sequence per script, its moment from the vault folders when its name has none', async () => {
    const scripts = await connect(world()).listPlatformScripts();
    expect(scripts.map((s) => [s.ref.id, s.moment, s.steps.map((step) => step.priceMinor)])).toEqual([
      ['sequence_1', 'day', [500, 1_500, 3_000]],
      ['sequence_2', null, [500, 1_500, 3_000]],
      ['sequence_3', 'night', [500, 1_500, 3_000]],
      ['sequence_4', 'night', [500, 1_500, 3_000]],
    ]);
    expect(scripts[0]?.steps[1]).toMatchObject({
      ref: { id: 'script_1_2' },
      index: 1,
      text: 'Coucou %NAME%, étape 2 du script 1',
      media: [{ ref: { id: 'media_02' }, kind: 'image' }],
      previewMedia: [{ ref: { id: 'media_09' }, kind: 'video' }],
    });
  });

  it('reads the steps already sent to a fan, and which were bought (ADR 0018 § 5)', async () => {
    const connector = connect(world());
    const ids = (steps: { stepRef: { id: string }; isPaid: boolean }[]) =>
      steps.map((s) => [s.stepRef.id, s.isPaid]);
    expect(ids(await connector.getScriptHistory(fan('fan_02')))).toEqual([
      ['script_1_1', true],
      ['script_1_2', true],
      ['script_1_3', false],
    ]);
    expect(ids(await connector.getScriptHistory(fan('fan_03')))).toEqual([
      ['script_2_1', false],
      ['script_2_2', false],
    ]);
    expect(await connector.getScriptHistory(fan('fan_04'))).toEqual([]);
  });

  it('lists the vault with each media’s folder, or one folder', async () => {
    const connector = connect(world());
    const vault = await connector.listVaultMedia({});
    expect(vault).toHaveLength(15);
    expect(vault.find((m) => m.ref.id === 'media_03')).toMatchObject({
      kind: 'video',
      folder: { ref: { id: 'folder_1' }, name: 'SCRIPT 1 | ☀️' },
    });
    expect(
      await connector.listVaultMedia({ folderRef: { platform: 'reveal', id: 'folder_2' } }),
    ).toHaveLength(5);
    const missing = connector.listVaultMedia({ folderRef: { platform: 'reveal', id: 'folder_9' } });
    expect((await rejection(missing)).code).toBe('not_found');
  });

  it('lists transactions, newest first, until `since`', async () => {
    const connector = connect(world());
    const all = await connector.listTransactions({});
    expect(all.map((t) => [t.kind, t.amountMinor])).toEqual([
      ['tip', 1_000],
      ['ppv', 1_500],
      ['ppv', 500],
    ]);
    expect(await connector.listTransactions({ since: new Date(all[1]?.createdAt ?? 0) })).toHaveLength(1);
  });

  it('refuses every write until P2-03', async () => {
    const connector = connect(world('quiet'));
    expect((await rejection(connector.sendText())).code).toBe('fatal');
    expect((await rejection(connector.sendMedia())).code).toBe('fatal');
    expect((await rejection(connector.verifySent())).code).toBe('fatal');
  });
});
