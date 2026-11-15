import { randomBytes } from 'node:crypto';

import { TelegramLinkCodeSchema, TelegramPrivateLinkSchema } from '@impera/contracts';
import { eq, parseEncryptionKeys, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { preValidationAsyncHookHandler } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { createTelegramModule, type TelegramModule } from '..';
import { testConfig } from '../../../__tests__/support/config';
import { createJobQueue, type JobQueue } from '../../../jobs';
import { createLogger } from '../../../logger';
import { buildServer, type Server } from '../../../server';
import { EXPIRED_TEXT, LINKED_TEXT, codeHashOf } from '../application/private-link';
import { createPostgresTelegramStore } from '../infra/postgres.store';
import { createPostgresPrivateLinksStore } from '../infra/private-links.store';

import { FAKE_TOKEN, FakeTelegram } from './support/fake-telegram';

const USER_ID = 'member-private-link';

/** SEC-05 lot 2, ADR 0068 § 4: an account links its private chat with the agency's bot by `/start <code>`. */
describe('private Telegram link on Postgres', () => {
  let test: TestDb;
  let queue: JobQueue;
  let telegram: FakeTelegram;
  let module: TelegramModule;
  let server: Server;
  let offsetMs = 0;
  let updateId = 0;
  const clock = { now: () => new Date(Date.now() + offsetMs) };
  const config = testConfig();
  const headers = { origin: config.WEB_ORIGIN };

  const signedIn: preValidationAsyncHookHandler = async (request) => {
    request.user = {
      id: USER_ID,
      email: 'member@example.test',
      name: 'Membre',
      role: 'operator',
      creatorIds: [],
      routedCreatorIds: [],
      shiftCreatorIds: [],
    };
    return Promise.resolve();
  };
  const freshOnly: preValidationAsyncHookHandler = async (request, reply) => {
    if (request.headers['x-test-stale'] === '1')
      await reply.code(403).send({ error: { code: 'reauthentication_forbidden' } });
  };

  /** The bot's next poll reads `/start <code>` from this private chat. */
  async function start(botId: string, chatId: string, code: string): Promise<void> {
    updateId += 1;
    telegram.updates.push({ kind: 'start', updateId, telegramChatId: chatId, code });
    const bot = (await module.overview()).bots.find((row) => row.id === botId);
    if (bot === undefined) throw new Error('bot not found');
    await module.jobs.pollUpdates(bot.id, 0);
  }

  async function issue(): Promise<{ code: string; url: string }> {
    const response = await server.inject({ method: 'POST', url: '/v1/auth/telegram-link/code', headers });
    expect(response.statusCode).toBe(200);
    return TelegramLinkCodeSchema.parse(response.json());
  }

  async function linkState() {
    const response = await server.inject({ method: 'GET', url: '/v1/auth/telegram-link', headers });
    return TelegramPrivateLinkSchema.parse(response.json());
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // Graphile's schema: adding a bot queues its first poll.
    queue = await createJobQueue(test.admin.pool);
    await test.admin.db
      .insert(schema.user)
      .values({ id: USER_ID, name: 'Membre', email: 'member@example.test' });
  });

  afterAll(async () => {
    await server.close();
    await queue.close();
    await test.close();
  });

  beforeEach(async () => {
    offsetMs = 0;
    telegram = new FakeTelegram();
    const store = createPostgresTelegramStore({
      adminDb: test.service.db,
      keys: parseEncryptionKeys(`v1:${randomBytes(32).toString('base64')}`),
    });
    module = createTelegramModule({
      bots: store.bots,
      deliveries: store.deliveries,
      privateLinks: createPostgresPrivateLinksStore(test.service.db),
      channel: telegram,
      clock,
      webOrigin: config.WEB_ORIGIN,
    });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: [module.privateLinkRoutes({ guard: signedIn, recentLogin: freshOnly })],
      readiness: () =>
        Promise.resolve({ isReady: true, checks: { database: true, migrations: true, worker: true } }),
    });
  });

  it('links the chat once by a fresh code, refuses a replayed or expired one, and unlinks', async () => {
    // No bot yet: no code to give.
    const none = await server.inject({ method: 'POST', url: '/v1/auth/telegram-link/code', headers });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ error: { code: 'telegram_link_no_bot_unprocessable' } });

    telegram.addBot(FAKE_TOKEN, 'demo_bot');
    const added = await module.addBot(FAKE_TOKEN);
    if (!added.ok) throw new Error(added.error.message);
    const botId = added.value.id;

    // A code needs a recent sign-in.
    const stale = await server.inject({
      method: 'POST',
      url: '/v1/auth/telegram-link/code',
      headers: { ...headers, 'x-test-stale': '1' },
    });
    expect(stale.statusCode).toBe(403);

    expect(await linkState()).toEqual({ linked: false, botUsername: null, linkedAt: null });
    const first = await issue();
    expect(first.url).toBe(`https://t.me/demo_bot?start=${first.code}`);
    // Only its hash is kept.
    const kept = await test.admin.db.select().from(schema.telegramLinkCodes);
    expect(kept).toEqual([expect.objectContaining({ userId: USER_ID, codeHash: codeHashOf(first.code) })]);
    expect(JSON.stringify(kept)).not.toContain(first.code);

    // A second code replaces the first.
    const code = await issue();
    await start(botId, '900000000501', first.code);
    expect(telegram.sent.at(-1)).toMatchObject({ chatId: '900000000501', text: EXPIRED_TEXT });
    expect((await linkState()).linked).toBe(false);

    await start(botId, '900000000501', code.code);
    expect(telegram.sent.at(-1)).toMatchObject({ chatId: '900000000501', text: LINKED_TEXT });
    expect(await linkState()).toMatchObject({ linked: true, botUsername: 'demo_bot' });
    const [link] = await test.admin.db.select().from(schema.telegramPrivateLinks);
    expect(link).toMatchObject({ userId: USER_ID, botId, telegramChatId: '900000000501' });

    // Replayed: taken already, the link stays on its chat.
    await start(botId, '777', code.code);
    expect(telegram.sent.at(-1)).toMatchObject({ chatId: '777', text: EXPIRED_TEXT });
    expect(
      await test.admin.db
        .select({ chat: schema.telegramPrivateLinks.telegramChatId })
        .from(schema.telegramPrivateLinks),
    ).toEqual([{ chat: '900000000501' }]);

    // Expired after ten minutes: refused and gone.
    const late = await issue();
    offsetMs = 10 * 60_000 + 1000;
    await start(botId, '777', late.code);
    expect(telegram.sent.at(-1)).toMatchObject({ chatId: '777', text: EXPIRED_TEXT });
    expect(await test.admin.db.select().from(schema.telegramLinkCodes)).toEqual([]);
    offsetMs = 0;

    // Unlinking needs a recent sign-in, and drops a pending code too.
    await issue();
    const staleUnlink = await server.inject({
      method: 'DELETE',
      url: '/v1/auth/telegram-link',
      headers: { ...headers, 'x-test-stale': '1' },
    });
    expect(staleUnlink.statusCode).toBe(403);
    const unlinked = await server.inject({ method: 'DELETE', url: '/v1/auth/telegram-link', headers });
    expect(unlinked.json()).toEqual({ linked: false, botUsername: null, linkedAt: null });
    expect(await test.admin.db.select().from(schema.telegramLinkCodes)).toEqual([]);

    // The audit names the account and the bot, never the code nor the chat.
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.userId, USER_ID));
    expect(audit.map((row) => row.action).sort()).toEqual([
      'telegram_private_link.code',
      'telegram_private_link.code',
      'telegram_private_link.code',
      'telegram_private_link.code',
      'telegram_private_link.link',
      'telegram_private_link.remove',
    ]);
    const written = JSON.stringify(audit);
    for (const secret of [first.code, code.code, late.code, '900000000501'])
      expect(written).not.toContain(secret);
  });

  it('keeps both tables away from the application role', async () => {
    for (const table of ['telegram_private_links', 'telegram_link_codes']) {
      // 42501: insufficient privilege.
      await expect(test.app.db.execute(sql.raw(`select * from ${table}`))).rejects.toMatchObject({
        cause: { code: '42501' },
      });
    }
  });
});
