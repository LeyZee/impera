import {
  ConnectorConfigSchema,
  CreatorIdSchema,
  PlatformAccountIdSchema,
  VAULT_DESCRIPTION_MAX,
  VAULT_FOLDER_NAME_MAX,
  VaultMediaSchema,
} from '@impera/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FAKE_REVEAL_FILE_HOST,
  createFakeReveal,
  type FakeReveal,
} from '../../../../../__tests__/fake-reveal/server';
import { ConnectorError } from '../../../domain/platform-connector';
import { MemorySendJournal } from '../../__tests__/memory-send-journal';
import type { FileTransport } from '../../download/vault-file';
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

function world(): FakeReveal {
  const fake = createFakeReveal();
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

  it('reads a JWT’s expiry: `warning` 2 h before it, `expired` once Reveal refuses it', async () => {
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
    expect(await at('2026-10-03T09:30:00.000Z').health()).toBe('valid');
    expect(await at('2026-10-03T10:30:00.000Z').health()).toBe('warning');
    await scenario(fake, [{ type: 'session_expired' }]);
    expect(await at('2026-10-03T10:30:00.000Z').health()).toBe('expired');
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
      const connector = factory(account, session, { sends: new MemorySendJournal() });
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

  it('leaves out a message deleted on Reveal, and reads a discounted paid media (2026-11-16)', async () => {
    const fake = world();
    const connector = connect(fake);
    const before = await connector.fetchMessages(fan('conv_01'), {});
    const target = before.at(-1);
    expect(target).toBeDefined();
    await scenario(fake, [{ type: 'message_deleted', atMs: 0, messageId: target?.ref.id }]);
    const after = await connector.fetchMessages(fan('conv_01'), {});
    expect(after).toHaveLength(before.length - 1);
    expect(after.map((m) => m.ref.id)).not.toContain(target?.ref.id);

    const sold = fake.state().messages.find((m) => m.conversationId === 'conv_02' && m.bundle !== null);
    if (sold?.bundle == null) throw new Error('the default world sells a bundle to fan 02');
    sold.bundle.discount = { priceCents: 900, durationMinutes: 60 };
    await expect(connector.fetchMessages(fan('conv_02'), {})).resolves.not.toHaveLength(0);
  });

  it("reads a fan's answer to one of her stories, in its conversation and in the list (2026-11-16)", async () => {
    const fake = world();
    const connector = connect(fake);
    const newest = fake
      .state()
      .messages.filter((m) => m.conversationId === 'conv_02')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const last = newest[0];
    if (last === undefined) throw new Error('the default world has messages with fan 02');
    last.storyReply = {
      storyId: 'story_01',
      thumbnailUrl: 'https://reveal.test/story',
      mediaType: 'video',
      isExpired: false,
    };
    const messages = await connector.fetchMessages(fan('conv_02'), {});
    expect(messages.map((m) => m.ref.id)).toContain(last.id);
    await expect(connector.listConversations({})).resolves.toHaveLength(12);
    await expect(connector.getConversation(fan('conv_02'))).resolves.toMatchObject({
      ref: { id: 'conv_02' },
    });
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

  it('reads one conversation by its id as the list gives it, `not_found` for one it does not have', async () => {
    const connector = connect(world());
    const listed = (await connector.listConversations({})).at(-1);
    if (listed === undefined) throw new Error('the default world has conversations');
    const fresh = connect(world());
    expect(await fresh.getConversation(listed.ref)).toEqual(listed);
    // Read alone, its fan is found for the fan's own reads (recette du 16/11: the copilot opened it first).
    expect((await fresh.getFanProfile(listed.fanRef)).fanRef).toEqual(listed.fanRef);
    expect((await rejection(fresh.getConversation(fan('conv_inconnue')))).code).toBe('not_found');
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
    // Her bio, read only (ADR 0154): the profile's own text.
    expect(await connector.getCreatorProfile()).toEqual({ bio: 'Description de test' });
    const ppv = await connector.getFanPpvStats(fan('fan_02'));
    expect(ppv).toMatchObject({ purchased: 2, offered: 3, highestPriceMinor: 3_000, lowestPriceMinor: 500 });
    // Sequence 1's last step, sent to fan 02 at minute 2 240 of the world, never bought.
    expect(ppv.lastOfferAt).toBe('2026-10-02T23:20:00.000Z');
    expect((await connector.getFanPpvStats(fan('fan_04'))).lastOfferAt).toBeNull();
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
    const ids = (steps: { stepRef: { id: string }; purchased: boolean }[]) =>
      steps.map((s) => [s.stepRef.id, s.purchased]);
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
      folder: { ref: { id: 'folder_1' }, name: 'SCRIPT 1 | ☀️', moment: 'day' },
      description: null,
      suggestedPriceMinor: null,
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
    });
    // Each folder in Reveal's own order (newest first on FakeReveal), ranked from 0 as the pages came.
    expect(
      vault.filter((m) => m.folder?.ref.id === 'folder_1').map((m) => [m.ref.id, m.folderPosition]),
    ).toEqual([
      ['media_05', 0],
      ['media_04', 1],
      ['media_03', 2],
      ['media_02', 3],
      ['media_01', 4],
    ]);
    expect(
      await connector.listVaultMedia({ folderRef: { platform: 'reveal', id: 'folder_2' } }),
    ).toHaveLength(5);
    const missing = connector.listVaultMedia({ folderRef: { platform: 'reveal', id: 'folder_9' } });
    expect((await rejection(missing)).code).toBe('not_found');
  });

  it('keeps the vault’s own text, and its suggested range only when both ends are given', async () => {
    const fake = world();
    const media = fake.state().media;
    const first = media.find((m) => m.id === 'media_01');
    const second = media.find((m) => m.id === 'media_02');
    if (first === undefined || second === undefined) throw new Error('fixture changed');
    first.description = 'Texte inventé du coffre';
    first.suggestedMinPrice = 1_000;
    first.suggestedMaxPrice = 2_500;
    second.description = '   ';
    second.suggestedMinPrice = 1_000;
    const vault = await connect(fake).listVaultMedia({});
    expect(vault.find((m) => m.ref.id === 'media_01')).toMatchObject({
      description: 'Texte inventé du coffre',
      suggestedPriceMinor: { min: 1_000, max: 2_500 },
    });
    expect(vault.find((m) => m.ref.id === 'media_02')).toMatchObject({
      description: null,
      suggestedPriceMinor: null,
    });
  });

  it('reads which media Reveal sent for free, and only those (ADR 0145 § 2)', async () => {
    const fake = world();
    const [conversation] = fake.state().conversations;
    if (conversation === undefined) throw new Error('fixture changed');
    const sent = (
      id: string,
      mediaIds: string[],
      bundle: { priceCents: number; mediaIds: string[] } | null,
    ) =>
      fake.state().messages.push({
        id,
        conversationId: conversation.id,
        direction: 'out',
        content: 'Texte inventé',
        mediaIds,
        bundle:
          bundle === null
            ? null
            : { id: `${id}_b`, ...bundle, teasingMediaIds: [], paidAt: null, transactionId: null },
        author: null,
        scriptId: null,
        isUnread: true,
        createdAt: fake.state().now,
      });
    sent('msg_free_a', ['media_11'], null);
    sent('msg_free_b', [], { priceCents: 0, mediaIds: ['media_12'] });
    sent('msg_paid', [], { priceCents: 1_500, mediaIds: ['media_13'] });
    const vault = await connect(fake).listVaultMedia({});
    const free = (id: string) => vault.find((m) => m.ref.id === id)?.sentForFree;
    expect([free('media_11'), free('media_12'), free('media_13'), free('media_14')]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('cuts a vault folder’s name and a description longer than the contract allows, never half an emoji', async () => {
    const fake = world();
    const state = fake.state();
    const folder = state.folders.find((f) => f.id === 'folder_1');
    const media = state.media.find((m) => m.id === 'media_01');
    if (folder === undefined || media === undefined) throw new Error('fixture changed');
    folder.name = `${'a'.repeat(VAULT_FOLDER_NAME_MAX - 1)}🌙 nuit`;
    media.description = 'Texte inventé '.repeat(500);
    const vault = await connect(fake).listVaultMedia({});
    const cut = vault.find((m) => m.ref.id === 'media_01');
    expect(cut?.folder?.name).toBe('a'.repeat(VAULT_FOLDER_NAME_MAX - 1));
    // The moment is read in the whole name, before it is cut.
    expect(cut?.folder?.moment).toBe('night');
    expect(cut?.description).toHaveLength(VAULT_DESCRIPTION_MAX);
    expect(() => VaultMediaSchema.array().parse(vault)).not.toThrow();
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
});

describe('RevealApiConnector: her automations (ADR 0110)', () => {
  it('marks the opener he chose, his reply to a story, her welcome and her reminder; reads them once', async () => {
    const fake = world();
    const state = fake.state();
    state.model.hooks = ['Salut %NAME%, je passe te dire coucou', 'Hello toi'];
    state.model.welcomeMessage = 'Bienvenue chez moi, %NAME% !';
    state.model.expirationReminderMessage = 'Ton abonnement finit dans trois jours';
    const ofConversation = state.messages.filter((m) => m.conversationId === 'conv_01');
    const [first, second, third, fourth] = [
      ofConversation.find((m) => m.direction === 'in'),
      ofConversation.find((m) => m.direction === 'out'),
      ofConversation.findLast((m) => m.direction === 'in'),
      ofConversation.findLast((m) => m.direction === 'out'),
    ];
    if (first === undefined || second === undefined || third === undefined || fourth === undefined)
      throw new Error('the default world has messages both ways in conv_01');
    first.content = 'Salut Léa, je passe te dire coucou';
    second.content = 'Bienvenue chez moi, Max !';
    third.storyReply = {
      storyId: 'story_test',
      thumbnailUrl: 'https://media.example.test/story',
      mediaType: 'video',
      isExpired: false,
    };
    fourth.content = 'Ton abonnement finit dans trois jours';
    const paths: string[] = [];
    const connector = connect(fake, { log: (entry) => paths.push(entry.route) });

    const all = await connector.fetchMessages(fan('conv_01'), {});
    const originOfId = (id: string) => all.find((m) => m.ref.id === id)?.origin;
    expect([first, second, third, fourth].map((m) => originOfId(m.id))).toEqual([
      'hook',
      'welcome',
      'story_reply',
      'expiration_reminder',
    ]);
    expect(all.filter((m) => m.origin !== undefined)).toHaveLength(4);

    await connector.fetchMessages(fan('conv_01'), { limit: 5 });
    expect(paths.filter((route) => route === 'models.sayHello')).toHaveLength(1);
  });

  it('reads the messages without marks when her automations cannot be read, and asks again 5 min later', async () => {
    const fake = world();
    fake.state().model.hooks = ['Hello toi'];
    const first = fake.state().messages.find((m) => m.conversationId === 'conv_01' && m.direction === 'in');
    if (first === undefined) throw new Error('the default world has a fan message in conv_01');
    first.content = 'Hello toi';
    let failing = true;
    let sayHelloCalls = 0;
    const fetch: RevealFetch = (url, init) => {
      if (!url.includes('/say-hello')) return fake.fetch(url, init);
      sayHelloCalls += 1;
      return failing ? Promise.resolve(new Response('{}', { status: 500 })) : fake.fetch(url, init);
    };
    let now = new Date('2026-11-16T12:00:00.000Z');
    const connector = connect(fake, { fetch, now: () => now });
    const all = await connector.fetchMessages(fan('conv_01'), {});
    expect(all).toHaveLength(320);
    expect(all.some((m) => m.origin !== undefined)).toBe(false);

    // Not asked again for 5 minutes, then read again.
    const calls = sayHelloCalls;
    failing = false;
    now = new Date('2026-11-16T12:04:59.000Z');
    await connector.fetchMessages(fan('conv_01'), { limit: 5 });
    expect(sayHelloCalls).toBe(calls);
    now = new Date('2026-11-16T12:05:01.000Z');
    const later = await connector.fetchMessages(fan('conv_01'), {});
    expect(sayHelloCalls).toBe(calls + 1);
    expect(later.filter((m) => m.origin === 'hook')).toHaveLength(1);
  });
});

describe('RevealApiConnector: a vault media’s sharp preview (ADR 0138)', () => {
  const FOLDER_1 = { platform: 'reveal', id: 'folder_1' } as const;
  const ref = (id: string) => ({ platform: 'reveal' as const, id });
  const PNG = [0x89, 0x50, 0x4e, 0x47];

  function previewer(
    fake: FakeReveal,
    extra: { transport?: FileTransport; hosts?: readonly string[]; listings?: string[] } = {},
  ): RevealApiConnector {
    return new RevealApiConnector({
      session: sessionOf(fake),
      fetch: fake.fetch,
      baseUrl: BASE,
      sleep: () => Promise.resolve(),
      // The vault files' own reader and hosts (ADR 0113 § 2): one list, one transport.
      fileTransport: extra.transport ?? fake.fileTransport,
      fileHosts: extra.hosts ?? [FAKE_REVEAL_FILE_HOST],
      fileHttpForTests: true,
      log: (entry) => {
        if (entry.route === 'vault.medias') extra.listings?.push(entry.route);
      },
    });
  }

  /** FakeReveal's transport, every link it is asked recorded. */
  function counting(fake: FakeReveal, asked: string[]): FileTransport {
    return {
      lookup: fake.fileTransport.lookup,
      get: (url, signal, pinned) => {
        asked.push(url);
        return fake.fileTransport.get(url, signal, pinned);
      },
    };
  }

  /** A transport answering `response` to anything, FakeReveal's public test address looked up. */
  function answering(fake: FakeReveal, response: () => Response): FileTransport {
    return { lookup: fake.fileTransport.lookup, get: () => Promise.resolve(response()) };
  }

  it('reads a photo’s small picture and a video’s poster, its folder listed once, by the vault files’ reader', async () => {
    const fake = world();
    const listings: string[] = [];
    const asked: string[] = [];
    const connector = previewer(fake, { transport: counting(fake, asked), listings });
    const [photo, poster] = await Promise.all([
      connector.readVaultPreview({ mediaRef: ref('media_01'), folderRef: FOLDER_1 }),
      connector.readVaultPreview({ mediaRef: ref('media_03'), folderRef: FOLDER_1 }),
    ]);
    for (const picture of [photo, poster]) {
      expect(picture.contentType).toBe('image/png');
      expect([...picture.bytes.slice(0, 4)]).toEqual(PNG);
    }
    // Two pictures asked together: one listing of the folder, shared.
    expect(listings).toHaveLength(1);
    // The poster, not the video's playlist: a picture, one GET each.
    expect(asked).toHaveLength(2);
    expect(asked.some((url) => url.includes('/poster?'))).toBe(true);
    expect(asked.some((url) => url.includes('/hls/'))).toBe(false);
  });

  it('says not_found for a media its folder does not list, and for a voice note', async () => {
    const fake = createFakeReveal({ fixture: 'quiet' });
    fakes.push(fake);
    const connector = previewer(fake);
    const missing = connector.readVaultPreview({ mediaRef: ref('media_99'), folderRef: FOLDER_1 });
    expect((await rejection(missing)).code).toBe('not_found');
    const voice = connector.readVaultPreview({
      mediaRef: ref('media_voice_01'),
      folderRef: { platform: 'reveal', id: 'folder_3' },
    });
    expect((await rejection(voice)).code).toBe('not_found');
  });

  it('refuses a picture from a host the files do not name, and anything but an image', async () => {
    const fake = world();
    const asked: string[] = [];
    // No host written: refused before any call, the host alone said, never the signed link.
    const nowhere = previewer(fake, { transport: counting(fake, asked), hosts: [] });
    const refused = await rejection(
      nowhere.readVaultPreview({ mediaRef: ref('media_01'), folderRef: FOLDER_1 }),
    );
    expect(refused.code).toBe('fatal');
    expect(refused.message).toContain(FAKE_REVEAL_FILE_HOST);
    expect(refused.message).not.toContain('sig=');
    expect(asked).toEqual([]);
    // A page instead of a picture.
    const page = answering(fake, () => new Response('<!doctype html><p>non</p>', { status: 200 }));
    const html = await rejection(
      previewer(fake, { transport: page }).readVaultPreview({
        mediaRef: ref('media_01'),
        folderRef: FOLDER_1,
      }),
    );
    expect(html.code).toBe('fatal');
    // Past the bound: refused, nothing kept.
    const huge = answering(fake, () => new Response(new Uint8Array(3 * 1024 * 1024), { status: 200 }));
    const big = await rejection(
      previewer(fake, { transport: huge }).readVaultPreview({
        mediaRef: ref('media_01'),
        folderRef: FOLDER_1,
      }),
    );
    expect(big.code).toBe('fatal');
    // A server error is transient: counted as any read's.
    const down = answering(fake, () => new Response(null, { status: 502 }));
    const failed = await rejection(
      previewer(fake, { transport: down }).readVaultPreview({
        mediaRef: ref('media_01'),
        folderRef: FOLDER_1,
      }),
    );
    expect(failed.code).toBe('transient');
  });

  it('lists the folder again once when the platform refuses a link kept, then reads it', async () => {
    const fake = world();
    const listings: string[] = [];
    const connector = previewer(fake, { listings });
    await connector.readVaultPreview({ mediaRef: ref('media_01'), folderRef: FOLDER_1 });
    // FakeReveal's links live 10 minutes: past them, the link kept in memory is refused.
    const moved = await fake.app.inject({
      method: 'POST',
      url: '/__clock',
      payload: { advanceMs: 11 * 60_000 },
    });
    expect(moved.statusCode).toBe(200);
    const again = await connector.readVaultPreview({ mediaRef: ref('media_02'), folderRef: FOLDER_1 });
    expect(again.contentType).toBe('image/png');
    expect(listings).toHaveLength(2);
  });
});
