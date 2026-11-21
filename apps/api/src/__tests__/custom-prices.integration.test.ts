import {
  CreatorIdSchema,
  CustomPriceGridViewSchema,
  emptyCustomPriceGrid,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
  type CustomPriceGrid,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createCustomPriceGridReader } from '../modules/custom-orders/infra/db/grid-store';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/** A filled grid with neutral test numbers, never the agency's prices (ADR 0010). */
function filled(): CustomPriceGrid {
  const empty = emptyCustomPriceGrid();
  return {
    formats: empty.formats.map((line) => ({ ...line, priceMinor: 1_000 })),
    supplements: [
      { id: 'sup_00000001', label: 'Test A', offered: true, percent: 10 },
      { id: 'sup_00000002', label: 'Test B', offered: false, percent: null },
    ],
  };
}

/**
 * Her grid of custom prices (ADR 0159 § C): the owner's alone, one version per save, a stale save refused. Invented
 * people, creators and prices only (ADR 0010).
 */
describe('/v1/creators/:creatorId/custom-prices', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies: Record<'owner' | 'manager' | 'chatter' | 'nora', string> = {
    owner: '',
    manager: '',
    chatter: '',
    nora: '',
  };

  const call = (method: 'GET' | 'PUT', creatorId: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url: `/v1/creators/${creatorId}/custom-prices`,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

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
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const [who, teamRole] of [
      ['manager', 'manager'],
      ['chatter', 'chatter'],
    ] as const) {
      const member = await account(`${who}@example.test`, { role: 'operator', creatorIds: [nora, ines] });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${who}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      cookies[who] = member.cookie;
    }
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives the empty grid, version 0, before any save', async () => {
    const response = await call('GET', nora, 'owner');
    expect(response.statusCode, response.body).toBe(200);
    expect(CustomPriceGridViewSchema.parse(response.json())).toEqual({
      creatorId: nora,
      version: 0,
      grid: emptyCustomPriceGrid(),
      updatedAt: null,
    });
  });

  it('saves a version on top of the one read, replays it as it is, and keeps her grid apart', async () => {
    const saved = await call('PUT', nora, 'owner', { baseVersion: 0, grid: filled() });
    expect(saved.statusCode, saved.body).toBe(200);
    const view = CustomPriceGridViewSchema.parse(saved.json());
    expect(view).toMatchObject({ creatorId: nora, version: 1, grid: filled() });
    expect(view.updatedAt).not.toBeNull();

    const replay = await call('PUT', nora, 'owner', { baseVersion: 0, grid: filled() });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(CustomPriceGridViewSchema.parse(replay.json()).version).toBe(1);

    const read = CustomPriceGridViewSchema.parse((await call('GET', nora, 'owner')).json());
    expect(read).toEqual(view);
    expect(CustomPriceGridViewSchema.parse((await call('GET', ines, 'owner')).json()).version).toBe(0);

    const audit = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'custom_price_grid.save'));
    expect(audit).toEqual([{ details: { version: 1, formatsOffered: 7, supplements: 2 } }]);

    // The agent's turn reads her grid in force as the service role, one creator at a time.
    const gridOf = createCustomPriceGridReader(test.service.db);
    expect(await gridOf(nora)).toEqual(filled());
    expect(await gridOf(ines)).toBeNull();
  });

  it('refuses a save on a stale version, and writes nothing', async () => {
    const changed = {
      ...filled(),
      formats: filled().formats.map((line) => ({ ...line, priceMinor: 2_000 })),
    };
    const stale = await call('PUT', nora, 'owner', { baseVersion: 0, grid: changed });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.json()).toMatchObject({
      error: { code: 'custom_prices_version_conflict', details: { current: 1 } },
    });
    const next = await call('PUT', nora, 'owner', { baseVersion: 1, grid: changed });
    expect(CustomPriceGridViewSchema.parse(next.json()).version).toBe(2);
  });

  it('refuses a grid the contract refuses', async () => {
    const broken = {
      ...filled(),
      supplements: [{ id: 'extra', label: 'Test C', offered: true, percent: 5 }],
    };
    expect((await call('PUT', nora, 'owner', { baseVersion: 2, grid: broken })).statusCode).toBe(400);
  });

  it('is closed to a manager, a chatter and her own account', async () => {
    for (const who of ['manager', 'chatter', 'nora'] as const) {
      expect((await call('GET', nora, who)).statusCode, who).toBe(403);
      expect((await call('PUT', nora, who, { baseVersion: 2, grid: filled() })).statusCode, who).toBe(403);
    }
  });

  it('answers 404 for a creator that does not exist', async () => {
    expect((await call('GET', newId(CreatorIdSchema), 'owner')).statusCode).toBe(404);
  });
});
