import {
  AgencyRedirectLinkSchema,
  AgencyRedirectLinksResponseSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * Her redirect links (INS-03, ADR 0121 § 1): the owner alone sets them, a manager of hers reads them, she reads « Mes liens », her
 * own links that are on and placed and nothing else of them. Invented data only (ADR 0010).
 */
describe('/v1/creators/:creatorId/redirect-links and /v1/creator-space/links', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies: Record<'nora' | 'ines' | 'owner' | 'manager' | 'outsideManager' | 'chatter', string> = {
    nora: '',
    ines: '',
    owner: '',
    manager: '',
    outsideManager: '',
    chatter: '',
  };

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  const link = (name: string, set: object = {}) => ({
    name,
    url: `https://liens.example.test/${encodeURIComponent(name)}`,
    destination: '',
    placement: 'story_daily',
    usageNote: 'À mettre dans ta story du jour',
    enabled: true,
    ...set,
  });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  async function create(creatorId: CreatorId, body: object, who: keyof typeof cookies = 'owner') {
    const response = await call('POST', `/v1/creators/${creatorId}/redirect-links`, who, body);
    expect(response.statusCode, response.body).toBe(200);
    return AgencyRedirectLinkSchema.parse(response.json());
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
    for (const [who, teamRole, creatorIds] of [
      ['manager', 'manager', [nora]],
      ['outsideManager', 'manager', [ines]],
      ['chatter', 'chatter', [nora, ines]],
    ] as const) {
      const member = await account(`${who}@example.test`, { role: 'operator', creatorIds: [...creatorIds] });
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
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('lets the owner set her links and her manager read them, with a line in the audit log', async () => {
    const story = await create(nora, link('Story du jour'));
    const unplaced = await create(nora, link('Ancien lien', { placement: null, usageNote: '' }));
    await create(nora, link('Canal', { placement: 'telegram_channel', enabled: false }));
    await create(ines, link('Story du jour', { usageNote: 'Pour Ines' }));

    const read = await call('GET', `/v1/creators/${nora}/redirect-links`, 'manager');
    expect(read.statusCode, read.body).toBe(200);
    const { links } = AgencyRedirectLinksResponseSchema.parse(read.json());
    expect(links.map((one) => one.name)).toEqual(['Ancien lien', 'Canal', 'Story du jour']);
    expect(links.find((one) => one.id === unplaced.id)?.placement).toBeNull();

    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, story.id));
    expect(audit).toEqual([
      {
        action: 'redirect_link.create',
        details: { placement: 'story_daily', enabled: true, hasUsageNote: true, urlChanged: false },
      },
    ]);
  });

  it('shows her only her own links that are on and placed, and nothing but the card', async () => {
    const mine = await call('GET', '/v1/creator-space/links', 'nora');
    expect(mine.statusCode, mine.body).toBe(200);
    const { links } = z.object({ links: z.array(z.record(z.string(), z.unknown())) }).parse(mine.json());
    expect(links).toHaveLength(1);
    // The card and nothing else: no figure, no destination, no switch, nothing of the redirect service.
    expect(Object.keys(links[0] ?? {}).sort()).toEqual(['id', 'name', 'placement', 'url', 'usageNote']);
    expect(links[0]).toMatchObject({
      name: 'Story du jour',
      placement: 'story_daily',
      usageNote: 'À mettre dans ta story du jour',
      url: 'https://liens.example.test/Story%20du%20jour',
    });

    const hers = await call('GET', '/v1/creator-space/links', 'ines');
    expect(hers.json()).toMatchObject({ links: [{ usageNote: 'Pour Ines' }] });
  });

  it('refuses everyone else', async () => {
    for (const who of ['nora', 'ines'] as const) {
      expect((await call('GET', `/v1/creators/${nora}/redirect-links`, who)).statusCode).toBe(403);
      expect((await call('POST', `/v1/creators/${nora}/redirect-links`, who, link('X'))).statusCode).toBe(
        403,
      );
    }
    for (const who of ['chatter', 'outsideManager'] as const) {
      const read = await call('GET', `/v1/creators/${nora}/redirect-links`, who);
      expect(read.statusCode, read.body).toBe(403);
      const write = await call('POST', `/v1/creators/${nora}/redirect-links`, who, link('X'));
      expect(write.statusCode, write.body).toBe(403);
    }
    // Her manager reads, never writes: an address decides where her readers land (ADR 0080 § 6).
    const managed = await call('POST', `/v1/creators/${nora}/redirect-links`, 'manager', link('X'));
    expect(managed.statusCode, managed.body).toBe(403);
    for (const who of ['owner', 'manager', 'chatter'] as const)
      expect((await call('GET', '/v1/creator-space/links', who)).statusCode).toBe(403);
    const unknown = await call('GET', `/v1/creators/${newId(CreatorIdSchema)}/redirect-links`, 'owner');
    expect(unknown.statusCode, unknown.body).toBe(403);
  });

  it('validates what the agency writes', async () => {
    const post = (body: object) => call('POST', `/v1/creators/${nora}/redirect-links`, 'owner', body);
    expect((await post(link('Sans https', { url: 'http://liens.example.test/a' }))).statusCode).toBe(400);
    expect((await post(link('Phrase', { usageNote: 'Va sur liens.example.test/a' }))).statusCode).toBe(400);
    expect((await post(link('Longue', { usageNote: 'a'.repeat(121) }))).statusCode).toBe(400);
    expect((await post(link('Endroit', { placement: 'bio' }))).statusCode).toBe(400);
    const twice = await post(link('story du jour'));
    expect(twice.statusCode, twice.body).toBe(409);
  });

  it('corrects a link of hers, never one of another creator', async () => {
    const read = await call('GET', `/v1/creators/${nora}/redirect-links`, 'owner');
    const { links } = AgencyRedirectLinksResponseSchema.parse(read.json());
    const canal = links.find((one) => one.name === 'Canal');
    if (canal === undefined) throw new Error('fixture: the link « Canal » is missing');

    const turnOn = { ...link('Canal', { placement: 'telegram_channel' }) };
    const managed = await call('PUT', `/v1/creators/${nora}/redirect-links/${canal.id}`, 'manager', turnOn);
    expect(managed.statusCode, managed.body).toBe(403);
    const on = await call('PUT', `/v1/creators/${nora}/redirect-links/${canal.id}`, 'owner', {
      ...turnOn,
      url: 'https://liens.example.test/nora/canal-neuf',
    });
    expect(on.statusCode, on.body).toBe(200);
    // The audit says the address changed, never the address.
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, canal.id));
    expect(audit.find((line) => line.action === 'redirect_link.update')?.details).toEqual({
      placement: 'telegram_channel',
      enabled: true,
      hasUsageNote: true,
      urlChanged: true,
    });
    expect(JSON.stringify(audit)).not.toContain('liens.example.test');
    const mine = await call('GET', '/v1/creator-space/links', 'nora');
    expect(mine.json()).toMatchObject({ links: [{ name: 'Story du jour' }, { name: 'Canal' }] });

    const elsewhere = await call(
      'PUT',
      `/v1/creators/${ines}/redirect-links/${canal.id}`,
      'owner',
      link('Canal'),
    );
    expect(elsewhere.statusCode, elsewhere.body).toBe(404);
  });

  it('asks the owner for a fresh confirmation before a write, never before a read', async () => {
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });
    const write = await call('POST', `/v1/creators/${nora}/redirect-links`, 'owner', link('Trop tard'));
    expect(write.statusCode, write.body).toBe(403);
    expect(write.json()).toMatchObject({ error: { code: 'reauthentication_forbidden' } });
    expect((await call('GET', `/v1/creators/${nora}/redirect-links`, 'owner')).statusCode).toBe(200);
    expect((await call('GET', '/v1/creator-space/links', 'nora')).statusCode).toBe(200);
  });
});
