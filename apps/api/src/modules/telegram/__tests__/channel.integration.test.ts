import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  RedirectLinkIdSchema,
  TelegramBotIdSchema,
  TelegramChannelConfigSchema,
  TelegramChannelViewSchema,
  TelegramChatIdSchema,
  newId,
  type CreatorId,
  type TelegramChannelConfig,
  type TelegramChatId,
} from '@impera/contracts';
import { eq, parseEncryptionKeys, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
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
      adminDb: test.admin.db,
      keys: parseEncryptionKeys(`v1:${randomBytes(32).toString('base64')}`),
    });
    module = createTelegramModule({
      bots: store.bots,
      deliveries: store.deliveries,
      channels: createPostgresChannelsStore(test.admin.db),
      channel: telegram,
      webOrigin: 'https://crm.example.test',
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
        { minute: 21 * 60 + 30, days: [6, 5], enabled: true },
        { minute: 12 * 60, days: [6], enabled: true },
      ],
      links: [{ id: linkId, name: 'Telegram', url: 'https://redirect.example.test/nora' }],
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
        { minute: 19 * 60, days: [1], enabled: true },
        { minute: 20 * 60, days: [1], enabled: true },
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
    const store = createPostgresChannelsStore(test.admin.db);
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
});
