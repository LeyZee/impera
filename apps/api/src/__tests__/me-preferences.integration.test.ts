import { CreatorIdSchema, MePreferencesSchema, MeSchema, newId } from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * An account's own preferences (`user_preferences`, ADR 0104 and ADR 0107): every role reads and writes its own row
 * and no other, and an account that chose nothing gets the defaults. Invented data only (ADR 0010).
 */
describe('PUT /v1/me/preferences', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: { userId: string; cookie: string };
  let chatter: { userId: string; cookie: string };
  let creator: { userId: string; cookie: string };

  const call = (method: 'GET' | 'PUT', url: string, cookie: string, payload?: Record<string, unknown>) => {
    const headers = { cookie, origin: DASHBOARD_ORIGIN };
    return payload === undefined
      ? server.inject({ method, url, headers })
      : server.inject({ method, url, headers, payload });
  };

  const sounds = async (cookie: string) =>
    MeSchema.parse((await call('GET', '/v1/me', cookie)).json()).preferences.sounds;

  async function account(email: string, set?: { role: 'creator' | 'operator'; creatorIds: string[] }) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    if (set !== undefined) await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), { composer: fixedComposer });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    const creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Nora', timezone: 'Europe/Paris' });
    owner = await account('owner@example.test');
    chatter = await account('chatter@example.test', { role: 'operator', creatorIds: [] });
    creator = await account('nora@example.test', { role: 'creator', creatorIds: [creatorId] });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('answers the defaults to an account that chose nothing, with no row written', async () => {
    for (const who of [owner, chatter, creator]) expect(await sounds(who.cookie)).toBe(true);
    expect(await test.admin.db.select().from(schema.userPreferences)).toEqual([]);
  });

  it('writes the row of the session, for every role, and no other', async () => {
    const put = await call('PUT', '/v1/me/preferences', chatter.cookie, { sounds: false });
    expect(put.statusCode).toBe(200);
    expect(MePreferencesSchema.parse(put.json())).toEqual({ sounds: false });
    expect(await sounds(chatter.cookie)).toBe(false);
    expect(await sounds(owner.cookie)).toBe(true);
    expect(await sounds(creator.cookie)).toBe(true);

    expect((await call('PUT', '/v1/me/preferences', creator.cookie, { sounds: false })).statusCode).toBe(200);
    expect((await call('PUT', '/v1/me/preferences', owner.cookie, { sounds: true })).statusCode).toBe(200);
    expect(await sounds(creator.cookie)).toBe(false);
    expect(await sounds(owner.cookie)).toBe(true);

    const rows = await test.admin.db
      .select({ userId: schema.userPreferences.userId, sounds: schema.userPreferences.soundsEnabled })
      .from(schema.userPreferences);
    expect(rows.toSorted((a, b) => a.userId.localeCompare(b.userId))).toEqual(
      [
        { userId: owner.userId, sounds: true },
        { userId: chatter.userId, sounds: false },
        { userId: creator.userId, sounds: false },
      ].toSorted((a, b) => a.userId.localeCompare(b.userId)),
    );
  });

  it('changes its mind on the same row', async () => {
    await call('PUT', '/v1/me/preferences', chatter.cookie, { sounds: true });
    expect(await sounds(chatter.cookie)).toBe(true);
    const rows = await test.admin.db
      .select()
      .from(schema.userPreferences)
      .where(eq(schema.userPreferences.userId, chatter.userId));
    expect(rows).toHaveLength(1);
  });

  it('refuses a body that names anything else, and a request without a session', async () => {
    expect(
      (await call('PUT', '/v1/me/preferences', chatter.cookie, { sounds: true, userId: owner.userId }))
        .statusCode,
    ).toBe(400);
    expect((await call('PUT', '/v1/me/preferences', chatter.cookie, { sounds: 'yes' })).statusCode).toBe(400);
    expect((await call('PUT', '/v1/me/preferences', '', { sounds: false })).statusCode).toBe(401);
  });
});
