import { randomBytes } from 'node:crypto';

import {
  CreatorIdSchema,
  DEFAULT_TELEGRAM_SALE_SETTINGS,
  JOB_NAMES,
  newId,
  TelegramSalesSettingsSchema,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** The worker and the API of ADR 0020: Telegram on when the tokens can be sealed, off otherwise. */
describe('Telegram wired in the app', () => {
  let test: TestDb;
  let withKeys: App;
  let withoutKeys: App;
  let server: Server;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const urls = { DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl };
    const config = testConfig({
      ...urls,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${randomBytes(32).toString('base64')}`,
    });
    withKeys = await createApp(config, createLogger(config), { withPlayground: false });
    withoutKeys = await createApp(testConfig(urls), createLogger(config), { withPlayground: false });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: withKeys.routes,
      readiness: withKeys.readiness,
    });
  });

  afterAll(async () => {
    await server.close();
    await withKeys.shutdown();
    await withoutKeys.shutdown();
    await test.close();
  });

  it('gives the worker a task for every Telegram job of the contract', () => {
    const telegramJobs = JOB_NAMES.filter((name) => name.startsWith('telegram.'));
    expect(telegramJobs).toHaveLength(8);
    expect(Object.keys(withKeys.tasks)).toEqual(expect.arrayContaining(telegramJobs));
  });

  it('serves Réglages › Telegram to a signed-in owner only', async () => {
    expect(withKeys.modules.telegram).not.toBeNull();
    const response = await server.inject({ method: 'GET', url: '/v1/settings/telegram' });
    expect(response.statusCode).toBe(401);
  });

  it('starts without Telegram when no key can seal a bot token, its jobs still known to the worker', () => {
    expect(withoutKeys.modules.telegram).toBeNull();
    expect(withoutKeys.tasks['telegram.scan']).toBeDefined();
  });

  it('reads and saves the sales settings for the owner only, refusing a creator that does not exist', async () => {
    const owner = { email: 'owner-sales@example.test', name: 'Owner', password: 'owner sales correct horse' };
    const chatter = {
      email: 'chatter-sales@example.test',
      name: 'Chatter',
      password: 'chatter sales correct horse',
    };
    await createOwner(withKeys.auth, withKeys.db.db, owner);
    const { userId: chatterId } = await createOwner(withKeys.auth, withKeys.db.db, chatter);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, chatterId));
    const nora = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' });
    const ownerCookie = await signIn(server, owner.email, owner.password);
    const as = (cookie: string, method: 'GET' | 'PUT', payload?: Record<string, unknown>) =>
      server.inject({
        method,
        url: '/v1/settings/telegram/sales',
        headers: { cookie, origin: DASHBOARD_ORIGIN },
        ...(payload === undefined ? {} : { payload }),
      });

    // Nothing saved yet: the line for all, every sale rings and the digest goes.
    const empty = await as(ownerCookie, 'GET');
    expect(empty.statusCode, empty.body).toBe(200);
    expect(TelegramSalesSettingsSchema.parse(empty.json())).toEqual({
      settings: [{ creatorId: null, ...DEFAULT_TELEGRAM_SALE_SETTINGS }],
    });

    const settings = [
      { creatorId: null, minimumMinor: 2000, agentOnly: false, eveningDigest: true },
      { creatorId: nora, minimumMinor: 0, agentOnly: true, eveningDigest: false },
    ];
    const saved = await as(ownerCookie, 'PUT', { settings });
    expect(saved.statusCode, saved.body).toBe(200);
    const read = TelegramSalesSettingsSchema.parse((await as(ownerCookie, 'GET')).json());
    expect(read.settings).toEqual(expect.arrayContaining(settings));
    expect(read.settings).toHaveLength(2);

    // A creator removed meanwhile: refused whole, the saved list unchanged.
    const ghost = await as(ownerCookie, 'PUT', {
      settings: [
        { creatorId: newId(CreatorIdSchema), minimumMinor: 0, agentOnly: false, eveningDigest: true },
      ],
    });
    expect(ghost.statusCode).toBe(400);
    expect(ghost.json()).toMatchObject({ error: { code: 'telegram_creator_invalid' } });
    expect(TelegramSalesSettingsSchema.parse((await as(ownerCookie, 'GET')).json()).settings).toHaveLength(2);
    // Two lines for one creator: refused by the contract.
    expect((await as(ownerCookie, 'PUT', { settings: [settings[1], settings[1]] })).statusCode).toBe(400);

    // A member of the team neither reads nor saves them.
    const chatterCookie = await signIn(server, chatter.email, chatter.password);
    expect((await as(chatterCookie, 'GET')).statusCode).toBe(403);
    expect((await as(chatterCookie, 'PUT', { settings })).statusCode).toBe(403);
  });
});
