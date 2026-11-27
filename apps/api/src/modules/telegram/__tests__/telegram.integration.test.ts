import { randomBytes } from 'node:crypto';

import { EventIdSchema, newId, type TelegramBot, type TelegramChatId } from '@impera/contracts';
import { eq, parseEncryptionKeys, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { preValidationAsyncHookHandler } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createTelegramModule, type TelegramModule } from '..';
import { testConfig } from '../../../__tests__/support/config';
import { createJobQueue, type JobQueue } from '../../../jobs';
import { createLogger } from '../../../logger';
import { buildServer } from '../../../server';
import { createPostgresTelegramStore, type ResealReport } from '../infra/postgres.store';

import { FAKE_TOKEN, FakeTelegram, OTHER_TOKEN, SAME_BOT_NEW_TOKEN, joined } from './support/fake-telegram';

const keyOf = (version: string) => `${version}:${randomBytes(32).toString('base64')}`;

/**
 * The module on the real migrations, with Telegram played by FakeTelegram (ADR 0080). Since the 27/11/2026 it keeps the
 * bots and the channels they find, nothing of the agency's alerts.
 */
describe('telegram module on Postgres', () => {
  let test: TestDb;
  let queue: JobQueue;
  const keys = keyOf('v1');
  let telegram: FakeTelegram;
  let module: TelegramModule;

  function build(encryptionKeys = keys): {
    module: TelegramModule;
    resealTokens: () => Promise<ResealReport>;
  } {
    const store = createPostgresTelegramStore({
      adminDb: test.service.db,
      keys: parseEncryptionKeys(encryptionKeys),
    });
    return {
      module: createTelegramModule({ bots: store.bots, channel: telegram, resealTokens: store.resealTokens }),
      resealTokens: store.resealTokens,
    };
  }

  async function jobs(task: string) {
    const result = await test.admin.db.execute(
      sql`select queue_name, key, run_at from graphile_worker.jobs where task_identifier = ${task}`,
    );
    return z
      .array(
        z.object({ queue_name: z.string().nullable(), key: z.string().nullable(), run_at: z.coerce.date() }),
      )
      .parse(result.rows);
  }

  /** A bot that was made admin of one channel. */
  async function botInChannel(
    token: string,
    username: string,
    telegramChatId: string,
  ): Promise<{ bot: TelegramBot; chatId: TelegramChatId }> {
    telegram.addBot(token, username);
    const added = await module.addBot(token);
    if (!added.ok) throw new Error(added.error.message);
    telegram.updates.push(joined(telegram.updates.length + 1, telegramChatId, `Canal ${username}`));
    await module.jobs.pollUpdates(added.value.id, 0);
    const view = (await module.overview()).bots.find((bot) => bot.id === added.value.id);
    const chat = view?.chats.find((row) => row.title === `Canal ${username}`);
    if (view === undefined || chat === undefined) throw new Error('channel not found');
    return { bot: view, chatId: chat.id };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // Creates Graphile's schema, which `public.enqueue_job` writes to.
    queue = await createJobQueue(test.admin.pool);
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  beforeEach(async () => {
    telegram = new FakeTelegram();
    module = build().module;
    await test.admin.db.delete(schema.telegramBots);
    await test.admin.db.execute(sql`delete from graphile_worker._private_jobs`);
  });

  it('adds a bot from its token, sealed at rest, and never shows the token', async () => {
    expect(await module.addBot('pas un jeton')).toMatchObject({ ok: false, error: { kind: 'token_shape' } });
    expect(await module.addBot(FAKE_TOKEN)).toMatchObject({ ok: false, error: { kind: 'token_refused' } });

    telegram.addBot(FAKE_TOKEN, 'demo_canal_bot');
    const added = await module.addBot(FAKE_TOKEN);
    expect(added).toMatchObject({
      ok: true,
      value: { username: 'demo_canal_bot', state: 'active', chats: [] },
    });
    expect(await module.addBot(FAKE_TOKEN)).toMatchObject({ ok: false, error: { kind: 'bot_exists' } });

    const [row] = await test.admin.db.select().from(schema.telegramBots);
    expect(row?.tokenCiphertext.toString('latin1')).not.toContain(FAKE_TOKEN.split(':')[1]);
    expect(JSON.stringify(await module.overview())).not.toContain(FAKE_TOKEN.split(':')[1]);
    expect(await jobs('telegram.poll_updates')).toMatchObject([
      { queue_name: `telegram-bot:${row?.id ?? ''}` },
    ]);

    // The bot's own token only, after a /revoke.
    if (!added.ok) return;
    expect(await module.replaceToken(added.value.id, OTHER_TOKEN)).toMatchObject({
      ok: false,
      error: { kind: 'bot_mismatch' },
    });
    telegram.addBot(SAME_BOT_NEW_TOKEN, 'demo_canal_bot');
    expect(await module.replaceToken(added.value.id, SAME_BOT_NEW_TOKEN)).toMatchObject({ ok: true });
  });

  it('discovers the channels a bot enters, follows a supergroup migration and a 409 or 401', async () => {
    const { bot, chatId } = await botInChannel(FAKE_TOKEN, 'demo_bot', '-100');
    expect(bot.chats).toMatchObject([{ title: 'Canal demo_bot', membership: 'member', canPost: true }]);

    telegram.updates.push({ kind: 'migration', updateId: 10, fromChatId: '-100', toChatId: '-1001' });
    await module.jobs.pollUpdates(bot.id, 0);
    const [chat] = await test.admin.db
      .select()
      .from(schema.telegramChats)
      .where(eq(schema.telegramChats.id, chatId));
    expect(chat).toMatchObject({ telegramChatId: '-1001', kind: 'supergroup' });

    telegram.failNext('getUpdates', { kind: 'conflict' });
    await module.jobs.pollUpdates(bot.id, 0);
    expect((await module.overview()).bots[0]?.state).toBe('conflict');
    await module.jobs.pollUpdates(bot.id, 0);
    expect((await module.overview()).bots[0]?.state).toBe('active');

    telegram.revoke(FAKE_TOKEN);
    await module.jobs.pollUpdates(bot.id, 0);
    expect((await module.overview()).bots[0]?.state).toBe('refused');
  });

  it('keeps a channel the bot was banned from in the list, and removes it on request (REG-28)', async () => {
    const { bot, chatId } = await botInChannel(FAKE_TOKEN, 'demo_bot', '-100');
    expect(await module.removeChat(chatId, 'owner-telegram')).toBe('refused');
    telegram.updates.push({
      kind: 'membership',
      updateId: telegram.updates.length + 1,
      telegramChatId: '-100',
      title: 'Canal demo_bot',
      chatKind: 'channel',
      membership: 'kicked',
      canPost: false,
    });
    await module.jobs.pollUpdates(bot.id, 0);
    const before = await module.overview();
    expect(before.bots[0]?.chats).toMatchObject([{ id: chatId, membership: 'kicked', canPost: false }]);

    expect(await module.removeChat(chatId, 'owner-telegram')).toBe('removed');
    expect((await module.overview()).bots[0]?.chats).toEqual([]);
    const audit = await test.admin.db
      .select({ userId: schema.auditLog.userId, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'telegram_chat.remove'));
    expect(audit).toEqual([{ userId: 'owner-telegram', details: { membership: 'kicked' } }]);
    expect(await module.removeChat(chatId, 'owner-telegram')).toBe('missing');
  });

  it('no longer enqueues a scan when an event commits: the trigger of the agency’s alerts is gone', async () => {
    await test.admin.db.insert(schema.domainEvents).values({
      id: newId(EventIdSchema),
      creatorId: null,
      type: 'kill_switch_toggled',
      payload: { scope: 'global', scopeId: null, active: true, reason: 'test' },
      actor: 'system',
      correlationId: 'test',
    });
    expect(await jobs('telegram.scan')).toEqual([]);
  });

  it('re-seals the tokens with the newest key, so the old key can be dropped', async () => {
    telegram.addBot(FAKE_TOKEN, 'demo_bot');
    await module.addBot(FAKE_TOKEN);
    const next = keyOf('v2');
    const rotated = build(`${next},${keys}`);
    expect(await rotated.resealTokens()).toEqual({ rewritten: 1, unreadable: [] });
    expect(await rotated.resealTokens()).toEqual({ rewritten: 0, unreadable: [] });
    const [row] = await test.admin.db.select().from(schema.telegramBots);
    expect(row?.keyVersion).toBe('v2');
    // Only the new key now: the bot still reads.
    expect((await build(next).module.overview()).bots[0]?.state).toBe('active');
    // A key that never sealed it: the bot reads as to reconnect, nothing thrown.
    expect((await build(keyOf('v3')).module.overview()).bots[0]?.state).toBe('refused');
    // And the rotation names it instead of passing over it, so the old key is not dropped too early.
    expect(await build(keyOf('v3')).resealTokens()).toEqual({ rewritten: 0, unreadable: ['@demo_bot'] });
  });

  it('serves the settings to the owner only, a bot change after a fresh sign-in only', async () => {
    const ownerOnly: preValidationAsyncHookHandler = async (request, reply) => {
      if (request.headers['x-test-role'] !== 'owner') {
        await reply.code(403).send({ error: 'forbidden' });
        return;
      }
      request.user = {
        id: 'owner-telegram',
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
    const config = testConfig();
    const server = await buildServer({
      config,
      logger: createLogger(config),
      routes: [module.routes({ guard: ownerOnly, recentLogin: freshOnly })],
      readiness: () =>
        Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
    });
    const headers = { 'x-test-role': 'owner', origin: config.WEB_ORIGIN };
    try {
      expect((await server.inject({ method: 'GET', url: '/v1/settings/telegram' })).statusCode).toBe(403);
      telegram.addBot(FAKE_TOKEN, 'demo_bot');
      const stale = await server.inject({
        method: 'POST',
        url: '/v1/settings/telegram/bots',
        headers: { ...headers, 'x-test-stale': '1' },
        payload: { token: FAKE_TOKEN },
      });
      expect(stale.statusCode).toBe(403);
      const created = await server.inject({
        method: 'POST',
        url: '/v1/settings/telegram/bots',
        headers,
        payload: { token: FAKE_TOKEN },
      });
      expect(created.statusCode).toBe(201);
      expect(created.body).not.toContain(FAKE_TOKEN.split(':')[1]);
      const refused = await server.inject({
        method: 'POST',
        url: '/v1/settings/telegram/bots',
        headers,
        payload: { token: 'nope' },
      });
      expect(refused.statusCode).toBe(422);
      // MOT-13: the common body, the kind in `details`.
      expect(refused.json()).toMatchObject({
        error: {
          code: 'telegram_token_unprocessable',
          details: { kind: 'token_shape' },
        },
      });
      const overview = await server.inject({ method: 'GET', url: '/v1/settings/telegram', headers });
      expect(overview.json()).toMatchObject({ bots: [{ username: 'demo_bot' }] });
      // Refusals in the common error body (recette 28/10): an invalid body is a 400, never a 500.
      const invalid = await server.inject({
        method: 'POST',
        url: '/v1/settings/telegram/bots',
        headers,
        payload: {},
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toMatchObject({ error: { code: 'request_invalid' } });
      // The agency's alerts left Telegram (27/11/2026): no routing, no journal, no test message any more.
      for (const [method, url] of [
        ['PUT', '/v1/settings/telegram/routes'],
        ['GET', '/v1/settings/telegram/deliveries'],
        ['GET', '/v1/settings/telegram/sales'],
      ] as const) {
        expect((await server.inject({ method, url, headers })).statusCode, url).toBe(404);
      }
      const missing = await server.inject({
        method: 'POST',
        url: `/v1/settings/telegram/bots/${newId(z.uuid().brand<'TelegramBotId'>())}/listen`,
        headers,
      });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toMatchObject({ error: { code: 'telegram_bot_not_found' } });
      const gone = await server.inject({
        method: 'DELETE',
        url: `/v1/settings/telegram/bots/${newId(z.uuid().brand<'TelegramBotId'>())}`,
        headers,
      });
      expect(gone.statusCode).toBe(404);
      expect(gone.json()).toMatchObject({ error: { code: 'telegram_bot_not_found' } });
      const noGroup = await server.inject({
        method: 'DELETE',
        url: `/v1/settings/telegram/chats/${newId(z.uuid().brand<'TelegramChatId'>())}`,
        headers,
      });
      expect([noGroup.statusCode, noGroup.json()]).toMatchObject([
        404,
        { error: { code: 'telegram_chat_not_found' } },
      ]);
      const { id: botId } = created.json<{ id: string }>();
      telegram.updates.push(joined(telegram.updates.length + 1, '-300', 'Canal vivant'));
      await module.jobs.pollUpdates(z.uuid().brand<'TelegramBotId'>().parse(botId), 0);
      const living = (await module.overview()).bots[0]?.chats[0];
      if (living === undefined) throw new Error('group not found');
      const stillIn = await server.inject({
        method: 'DELETE',
        url: `/v1/settings/telegram/chats/${living.id}`,
        headers,
      });
      expect([stillIn.statusCode, stillIn.json()]).toMatchObject([
        409,
        { error: { code: 'telegram_chat_member_conflict' } },
      ]);
    } finally {
      await server.close();
    }
  });
});
