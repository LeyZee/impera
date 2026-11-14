import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  RedirectLinkIdSchema,
  TelegramBotIdSchema,
  TelegramChannelConfigSchema,
  TelegramChannelViewSchema,
  TelegramChatIdSchema,
  TriedChannelPostSchema,
  err,
  newId,
  ok,
  type CreatorId,
  type TelegramChannelConfig,
  type TelegramChatId,
} from '@impera/contracts';
import { eq, parseEncryptionKeys, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { ChannelPostInput, ChannelPostResult, LlmGateway } from '@impera/llm';
import type { preValidationAsyncHookHandler } from 'fastify';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createTelegramModule, type TelegramModule } from '..';
import { testConfig } from '../../../__tests__/support/config';
import { createJobQueue, type JobQueue } from '../../../jobs';
import { createLogger } from '../../../logger';
import { buildServer } from '../../../server';
import { createPostgresChannelsStore } from '../infra/channels.store';
import { createPostgresTelegramStore } from '../infra/postgres.store';

import { FAKE_TOKEN, FakeTelegram } from './support/fake-telegram';

/** Réglages › Créatrices › Canal Telegram on the real migrations (ADR 0080 § 6), Telegram played by FakeTelegram. */
describe('the creator’s Telegram channel on Postgres', () => {
  let test: TestDb;
  let queue: JobQueue;
  let server: Awaited<ReturnType<typeof buildServer>>;
  let module: TelegramModule;
  let nora: CreatorId;
  let lea: CreatorId;
  let channelA: TelegramChatId;
  let channelB: TelegramChatId;
  let group: TelegramChatId;
  const telegram = new FakeTelegram();
  const voiceCalls: ChannelPostInput[] = [];
  let voiceAnswer: ChannelPostResult | null = { kind: 'post', text: 'Ce soir **live** <3 bisous' };
  const voice: LlmGateway['channelPost'] = (input) => {
    voiceCalls.push(input);
    return Promise.resolve(
      voiceAnswer === null
        ? err({ code: 'all_models_failed', attempts: [] })
        : ok({
            output: voiceAnswer,
            meta: {
              provider: 'xai',
              model: 'grok-4.7',
              isFallback: false,
              latencyMs: 1,
              promptHash: 'test',
            },
          }),
    );
  };
  const config = testConfig();
  const headers = { 'x-test-role': 'owner', origin: config.WEB_ORIGIN };

  const ownerOnly: preValidationAsyncHookHandler = async (request, reply) => {
    if (request.headers['x-test-role'] !== 'owner') {
      await reply.code(403).send({ error: 'forbidden' });
      return;
    }
    request.user = {
      id: 'owner-channel',
      email: 'owner@example.test',
      name: 'Owner',
      role: 'owner',
      creatorIds: [],
      routedCreatorIds: [],
      shiftCreatorIds: [],
    };
  };
  const freshOnly: preValidationAsyncHookHandler = async (request, reply) => {
    if (request.headers['x-test-stale'] === '1')
      await reply.code(403).send({ error: { code: 'reauthentication_forbidden' } });
  };

  const url = (creatorId: string) => `/v1/creators/${creatorId}/telegram-channel`;
  const put = (creatorId: string, body: TelegramChannelConfig, extra: Record<string, string> = {}) =>
    server.inject({
      method: 'PUT',
      url: url(creatorId),
      headers: { ...headers, ...extra },
      payload: { config: body },
    });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // Graphile's schema, which adding a bot enqueues its first reading in.
    queue = await createJobQueue(test.admin.pool);
    nora = newId(CreatorIdSchema);
    lea = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: lea, nameKey: lea, displayName: 'Léa', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db
      .insert(schema.user)
      .values({ id: 'owner-channel', name: 'Owner', email: 'owner@example.test', emailVerified: true });
    const store = createPostgresTelegramStore({
      adminDb: test.service.db,
      keys: parseEncryptionKeys(`v1:${randomBytes(32).toString('base64')}`),
    });
    module = createTelegramModule({
      bots: store.bots,
      deliveries: store.deliveries,
      channels: createPostgresChannelsStore(test.service.db),
      channel: telegram,
      webOrigin: 'https://crm.example.test',
      channelWriter: {
        // Nora has an active persona, no one else.
        persona: (creatorId) =>
          Promise.resolve(
            creatorId === nora
              ? {
                  version: '2.0.0',
                  creatorName: 'Nora',
                  personaSheet: 'identity:\n  first_name: Nora',
                  check: (texts) =>
                    texts.some((text) => text.includes('bisous'))
                      ? [{ code: 'forbidden_term', blocking: true, match: 'bisous' }]
                      : [],
                }
              : null,
          ),
        gateway: { channelPost: voice },
      },
    });
    telegram.addBot(FAKE_TOKEN, 'agence_bot');
    const added = await module.addBot(FAKE_TOKEN);
    if (!added.ok) throw new Error('bot refused');
    const botId = TelegramBotIdSchema.parse(added.value.id);
    telegram.updates.push(
      {
        kind: 'membership',
        updateId: 1,
        telegramChatId: '-1001',
        title: 'Canal A',
        chatKind: 'channel',
        membership: 'member',
        canPost: true,
      },
      {
        kind: 'membership',
        updateId: 2,
        telegramChatId: '-1002',
        title: 'Canal B',
        chatKind: 'channel',
        membership: 'member',
        canPost: false,
      },
      {
        kind: 'membership',
        updateId: 3,
        telegramChatId: '-1003',
        title: 'Équipe',
        chatKind: 'supergroup',
        membership: 'member',
        canPost: true,
      },
    );
    await module.jobs.pollUpdates(botId, 0);
    const chats = await test.admin.db.select().from(schema.telegramChats);
    const idOf = (title: string) => {
      const found = chats.find((chat) => chat.title === title);
      if (found === undefined) throw new Error(`no chat ${title}`);
      return TelegramChatIdSchema.parse(found.id);
    };
    channelA = idOf('Canal A');
    channelB = idOf('Canal B');
    group = idOf('Équipe');
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: [module.routes({ guard: ownerOnly, recentLogin: freshOnly })],
      readiness: () =>
        Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
    });
  });

  afterAll(async () => {
    await server.close();
    await queue.close();
    await test.close();
  });

  it('shows the defaults, the channels only, and what is missing', async () => {
    expect((await server.inject({ method: 'GET', url: url(nora) })).statusCode).toBe(403);
    const response = await server.inject({ method: 'GET', url: url(nora), headers });
    expect(response.statusCode).toBe(200);
    const view = TelegramChannelViewSchema.parse(response.json());
    expect(view.saved).toBe(false);
    expect(view.config).toEqual(DEFAULT_TELEGRAM_CHANNEL_CONFIG);
    expect(view.channels.map((choice) => [choice.title, choice.canPost])).toEqual([
      ['Canal A', true],
      ['Canal B', false],
    ]);
    expect(view.warnings).toEqual(['no_channel', 'no_link']);
  });

  it('saves her channel, slots and links, sorted, with a fresh sign-in and an audit row', async () => {
    const linkId = newId(RedirectLinkIdSchema);
    const body: TelegramChannelConfig = {
      ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
      chatId: channelA,
      slots: [
        { minute: 21 * 60 + 30, role: 'engagement', days: [6, 5], enabled: true },
        { minute: 12 * 60, role: 'engagement', days: [6], enabled: true },
      ],
      links: [
        {
          id: linkId,
          name: 'Telegram',
          url: 'https://redirect.example.test/nora',
          destination: 'mon Reveal',
        },
      ],
      channelLinkId: linkId,
    };
    expect((await put(nora, body, { 'x-test-stale': '1' })).statusCode).toBe(403);
    const saved = await put(nora, body);
    expect(saved.statusCode).toBe(200);
    const view = TelegramChannelViewSchema.parse(saved.json());
    expect(view.saved).toBe(true);
    expect(view.warnings).toEqual([]);
    expect(view.config.slots.map((slot) => [slot.minute, slot.days])).toEqual([
      [720, [6]],
      [1290, [5, 6]],
    ]);
    const audit = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'telegram_channel.save'));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.details)).not.toContain('redirect.example.test');
  });

  it('refuses slots too close, in the common body', async () => {
    const response = await put(lea, {
      ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
      slots: [
        { minute: 19 * 60, role: 'engagement', days: [1], enabled: true },
        { minute: 20 * 60, role: 'engagement', days: [1], enabled: true },
      ],
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: 'telegram_channel_invalid', details: { kind: 'slots_too_close' } },
    });
  });

  it('refuses a group, and another creator’s channel', async () => {
    const asGroup = await put(lea, { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, chatId: group });
    expect(asGroup.json()).toMatchObject({ error: { details: { kind: 'chat_not_channel' } } });
    const taken = await put(lea, { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, chatId: channelA });
    expect(taken.json()).toMatchObject({ error: { details: { kind: 'chat_taken' } } });
    const other = await put(lea, { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, chatId: channelB });
    expect(other.statusCode).toBe(200);
    expect(TelegramChannelViewSchema.parse(other.json()).warnings).toEqual(['bot_cannot_post', 'no_link']);
  });

  it('never routes an alert to a creator’s channel', async () => {
    const overview = await module.overview();
    const refused = await server.inject({
      method: 'PUT',
      url: '/v1/settings/telegram/routes',
      headers,
      payload: {
        version: overview.version,
        routes: [{ creatorId: null, topic: 'urgent', chatId: channelA }],
      },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: { code: 'telegram_route_channel_invalid' } });
    const toGroup = await server.inject({
      method: 'PUT',
      url: '/v1/settings/telegram/routes',
      headers,
      payload: { version: overview.version, routes: [{ creatorId: null, topic: 'urgent', chatId: group }] },
    });
    expect(toGroup.statusCode).toBe(200);
  });

  it('answers 404 for a creator who does not exist, or is archived', async () => {
    const missing = await server.inject({ method: 'GET', url: url(newId(CreatorIdSchema)), headers });
    expect(missing.statusCode).toBe(404);
    await test.admin.db
      .update(schema.creators)
      .set({ archivedAt: new Date() })
      .where(eq(schema.creators.id, lea));
    expect((await server.inject({ method: 'GET', url: url(lea), headers })).statusCode).toBe(404);
  });

  it('gives the channel of an archived creator to whoever chooses it now', async () => {
    // Léa, archived just above, held Canal B.
    const mia = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: mia, nameKey: mia, displayName: 'Mia', timezone: 'Europe/Paris' });
    const view = TelegramChannelViewSchema.parse(
      (await server.inject({ method: 'GET', url: url(mia), headers })).json(),
    );
    expect(view.channels.find((choice) => choice.chatId === channelB)?.takenByOther).toBe(false);
    expect((await put(mia, { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, chatId: channelB })).statusCode).toBe(200);
    const [held] = await test.admin.db
      .select({ chatId: schema.telegramChannels.chatId, config: schema.telegramChannels.config })
      .from(schema.telegramChannels)
      .where(eq(schema.telegramChannels.creatorId, lea));
    expect(held?.chatId).toBeNull();
    expect(TelegramChannelConfigSchema.parse(held?.config).chatId).toBeNull();
  });

  it('reads a removed chat as no channel, and still saves her links', async () => {
    await test.admin.db.delete(schema.telegramChats).where(eq(schema.telegramChats.id, channelA));
    const view = TelegramChannelViewSchema.parse(
      (await server.inject({ method: 'GET', url: url(nora), headers })).json(),
    );
    expect(view.config.chatId).toBeNull();
    expect(view.warnings).toContain('no_channel');
    const saved = await put(nora, { ...view.config, linkLabel: 'Écris-moi ✨' });
    expect(saved.statusCode).toBe(200);
  });

  it('reads slots stored before they had a role: 19 h is the main post, the others engagement', async () => {
    const stored = {
      ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
      slots: [
        { minute: 9 * 60, days: [1], enabled: true },
        { minute: 19 * 60, days: [1], enabled: true },
      ],
    };
    await test.admin.db
      .update(schema.telegramChannels)
      .set({ config: stored })
      .where(eq(schema.telegramChannels.creatorId, nora));
    const view = TelegramChannelViewSchema.parse(
      (await server.inject({ method: 'GET', url: url(nora), headers })).json(),
    );
    expect(view.config.slots.map((slot) => [slot.minute, slot.role])).toEqual([
      [540, 'engagement'],
      [1140, 'main'],
    ]);
  });

  it('lets one of two saves at once take a channel, never both', async () => {
    const [bot] = await test.admin.db.select({ id: schema.telegramBots.id }).from(schema.telegramBots);
    if (bot === undefined) throw new Error('no bot');
    const chat = newId(TelegramChatIdSchema);
    await test.admin.db.insert(schema.telegramChats).values({
      id: chat,
      botId: bot.id,
      telegramChatId: '-1009',
      title: 'Canal C',
      kind: 'channel',
      membership: 'member',
      canPost: true,
    });
    const [one, two] = [newId(CreatorIdSchema), newId(CreatorIdSchema)];
    await test.admin.db.insert(schema.creators).values([
      { id: one, nameKey: one, displayName: 'Une', timezone: 'Europe/Paris' },
      { id: two, nameKey: two, displayName: 'Deux', timezone: 'Europe/Paris' },
    ]);
    const store = createPostgresChannelsStore(test.service.db);
    const setting = { ...DEFAULT_TELEGRAM_CHANNEL_CONFIG, chatId: chat };
    const results = await Promise.all([
      store.saveChannel(one, setting, 'owner-channel'),
      store.saveChannel(two, setting, 'owner-channel'),
    ]);
    expect([...results].sort()).toEqual(['chat_taken', 'saved']);
    const holders = await test.admin.db
      .select({ creatorId: schema.telegramChannels.creatorId })
      .from(schema.telegramChannels)
      .where(eq(schema.telegramChannels.chatId, chat));
    expect(holders).toHaveLength(1);
    const loser = results[0] === 'saved' ? two : one;
    expect(await store.findChannel(loser)).toBeNull();
  });

  describe('the playground’s « Post du canal » (ADR 0080 § 7)', () => {
    const live = newId(RedirectLinkIdSchema);
    const reveal = newId(RedirectLinkIdSchema);
    const tryUrl = (creatorId: string) => `${url(creatorId)}/try`;
    const tryPost = (creatorId: string, payload: Record<string, unknown>) =>
      server.inject({ method: 'POST', url: tryUrl(creatorId), headers, payload });
    const body = { kind: 'main', media: 'Une photo au miroir', advice: 'Parle du live', linkId: null };

    beforeAll(async () => {
      const saved = await put(nora, {
        ...DEFAULT_TELEGRAM_CHANNEL_CONFIG,
        // The channel itself does not matter to a try: earlier tests removed theirs.
        chatId: null,
        links: [
          {
            id: reveal,
            name: 'Reveal',
            url: 'https://redirect.example.test/nora',
            destination: 'mon Reveal',
          },
          {
            id: live,
            name: 'Live',
            url: 'https://redirect.example.test/live?a=1&b=2',
            destination: 'mon live TikTok ce soir 21 h',
          },
        ],
        channelLinkId: reveal,
        examples: ['Ce soir je réponds à tout le monde ✨'],
      });
      expect(saved.json()).toMatchObject({ saved: true });
    });

    it('writes a post with her persona, her examples and where the channel’s link leads, escaped, never sent', async () => {
      voiceCalls.length = 0;
      const sent = telegram.sent.length;
      expect((await server.inject({ method: 'POST', url: tryUrl(nora), payload: body })).statusCode).toBe(
        403,
      );

      const response = await tryPost(nora, body);

      expect(response.statusCode).toBe(200);
      const tried = TriedChannelPostSchema.parse(response.json());
      expect(tried.personaVersion).toBe('2.0.0');
      expect(tried.draft).toEqual({
        kind: 'post',
        segments: [
          { text: 'Ce soir ', style: 'plain' },
          { text: 'live', style: 'bold' },
          { text: ' <3 bisous', style: 'plain' },
        ],
        link: { text: 'Viens me parler ✨', url: 'https://redirect.example.test/nora', name: 'Reveal' },
        html: 'Ce soir <b>live</b> &lt;3 bisous\n\n<a href="https://redirect.example.test/nora">Viens me parler ✨</a>',
      });
      expect(tried.violations).toEqual([{ code: 'forbidden_term', blocking: true, match: 'bisous' }]);
      expect(voiceCalls).toEqual([
        expect.objectContaining({
          kind: 'main',
          creatorName: 'Nora',
          examples: ['Ce soir je réponds à tout le monde ✨'],
          media: 'Une photo au miroir',
          destination: 'mon Reveal',
          advice: 'Parle du live',
          trace: { creatorId: nora },
        }),
      ]);
      expect(telegram.sent.length).toBe(sent);
    });

    it('takes another of her links for this post only, and refuses one she does not have', async () => {
      voiceCalls.length = 0;
      const response = await tryPost(nora, { ...body, linkId: live });
      const tried = TriedChannelPostSchema.parse(response.json());
      expect(tried.draft.kind === 'post' && tried.draft.html).toContain(
        '<a href="https://redirect.example.test/live?a=1&amp;b=2">',
      );
      expect(voiceCalls[0]?.destination).toBe('mon live TikTok ce soir 21 h');

      const unknown = await tryPost(nora, { ...body, linkId: newId(RedirectLinkIdSchema) });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json()).toMatchObject({ error: { details: { kind: 'link_unknown' } } });
    });

    it('writes a poll without a link, nor a media, nor a place', async () => {
      voiceCalls.length = 0;
      voiceAnswer = { kind: 'poll', question: 'Ce soir, je fais quoi ?', options: ['Un live', 'Une story'] };
      const response = await tryPost(nora, { ...body, kind: 'poll' });
      voiceAnswer = { kind: 'post', text: 'Ce soir **live** <3 bisous' };

      expect(TriedChannelPostSchema.parse(response.json()).draft).toEqual({
        kind: 'poll',
        question: 'Ce soir, je fais quoi ?',
        options: ['Un live', 'Une story'],
      });
      expect(voiceCalls[0]).toMatchObject({ kind: 'poll', media: null, destination: null });
    });

    it('writes an engagement post without a link, whatever link was asked', async () => {
      voiceCalls.length = 0;
      const response = await tryPost(nora, { ...body, kind: 'engagement', linkId: live });

      const tried = TriedChannelPostSchema.parse(response.json());
      expect(tried.draft).toMatchObject({ kind: 'post', link: null });
      expect(voiceCalls[0]).toMatchObject({
        kind: 'engagement',
        media: 'Une photo au miroir',
        destination: null,
      });
    });

    it('says why nothing was written: no persona, no model, no creator', async () => {
      // Léa was archived above: a creator of her own, without a persona.
      const zoe = newId(CreatorIdSchema);
      await test.admin.db
        .insert(schema.creators)
        .values({ id: zoe, nameKey: zoe, displayName: 'Zoé', timezone: 'Europe/Paris' });
      const none = await tryPost(zoe, body);
      expect(none.statusCode).toBe(400);
      expect(none.json()).toMatchObject({ error: { details: { kind: 'no_persona' } } });

      voiceAnswer = null;
      const failed = await tryPost(nora, body);
      voiceAnswer = { kind: 'post', text: 'Ce soir **live** <3 bisous' };
      expect(failed.json()).toMatchObject({ error: { details: { kind: 'llm_unavailable' } } });

      expect((await tryPost(newId(CreatorIdSchema), body)).statusCode).toBe(404);
    });
  });
});
