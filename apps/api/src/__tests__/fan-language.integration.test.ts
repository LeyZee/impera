import {
  FanIdSchema,
  FanLanguageViewSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type FanId,
} from '@impera/contracts';
import { and, eq, schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple horse' };

describe('the fan’s language (GET and PUT /v1/fans/:id/language, ADR 0168 § 3)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let operator: string;
  let creator: string;
  let operatorId: string;
  let anna: CreatorId;
  let bea: CreatorId;
  let fan: FanId;

  const get = (cookie: string, creatorId: string = anna) =>
    server.inject({
      method: 'GET',
      url: `/v1/fans/${fan}/language?creatorId=${creatorId}`,
      headers: { cookie },
    });
  const put = (cookie: string, payload: object, creatorId: string = anna) =>
    server.inject({
      method: 'PUT',
      url: `/v1/fans/${fan}/language?creatorId=${creatorId}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    bea = (await app.modules.persona.creators.create({ displayName: 'Bea' })).id;
    // An invented fan of Anna (ADR 0010).
    const accountId = newId(PlatformAccountIdSchema);
    fan = newId(FanIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId: anna, platform: 'reveal', handle: 'anna-demo' });
      await tx.insert(schema.fans).values({
        id: fan,
        creatorId: anna,
        platformAccountId: accountId,
        platformFanId: 'fan-1',
        displayName: 'Basile',
      });
    });
    operatorId = (await createOwner(app.auth, app.db.db, OPERATOR)).userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [anna] })
      .where(eq(schema.user.id, operatorId));
    const { userId: creatorUserId } = await createOwner(app.auth, app.db.db, CREATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [anna] })
      .where(eq(schema.user.id, creatorUserId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    creator = await signIn(server, CREATOR.email, CREATOR.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('is empty at first, then what code read on his messages', async () => {
    expect(FanLanguageViewSchema.parse((await get(operator)).json())).toEqual({ fanId: fan, language: null });
    await app.modules.fans.keepDetectedLanguage(anna, fan, 'italian');
    expect(FanLanguageViewSchema.parse((await get(owner)).json()).language).toMatchObject({
      value: 'italian',
      source: 'detected',
      setBy: null,
    });
  });

  it('is set by a chatter, audited, and code never overwrites it', async () => {
    const written = await put(operator, { language: 'english' });
    expect(written.statusCode).toBe(200);
    expect(FanLanguageViewSchema.parse(written.json()).language).toMatchObject({
      value: 'english',
      source: 'set',
      setBy: operatorId,
    });
    await app.modules.fans.keepDetectedLanguage(anna, fan, 'french');
    expect(FanLanguageViewSchema.parse((await get(operator)).json()).language?.value).toBe('english');
    const audit = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'fan.language_set'), eq(schema.auditLog.entityId, fan)));
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ userId: operatorId, entity: 'fan', details: { language: 'english' } });
  });

  it('refuses a value outside LANGUAGES, the creator, another creator and an unknown fan', async () => {
    expect((await put(operator, { language: 'en' })).statusCode).toBe(400);
    expect((await put(operator, { language: 'klingon' })).statusCode).toBe(400);
    expect((await get(creator)).statusCode).toBe(403);
    expect((await put(creator, { language: 'french' })).statusCode).toBe(403);
    expect((await put(operator, { language: 'french' }, bea)).statusCode).toBe(403);
    // Bea's tenant never reaches Anna's fan.
    expect((await get(owner, bea)).statusCode).toBe(404);
    expect((await put(owner, { language: 'french' }, bea)).statusCode).toBe(404);
    expect(FanLanguageViewSchema.parse((await get(owner)).json()).language?.value).toBe('english');
  });
});
