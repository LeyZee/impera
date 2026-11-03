import { randomBytes } from 'node:crypto';

import { JOB_NAMES } from '@impera/contracts';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';

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
    expect(telegramJobs).toHaveLength(7);
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
});
