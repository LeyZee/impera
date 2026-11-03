import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

import {
  CreatorIdSchema,
  ExtensionLinkCreatedSchema,
  ExtensionLinkStateSchema,
  newId,
  TeamMemberIdSchema,
  WatchSessionIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, afterEach, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const OWNER = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };

/**
 * The trend watch's doors (VEI-01 lot b, ADR 0060 § 2): « coller un lien » for the agency and for the creator,
 * « Relier l'extension », the readings of the extension. Invented data only (ADR 0010).
 */
describe('/v1/trends', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies: Record<'owner' | 'manager' | 'chatter' | 'creator', string> = {
    owner: '',
    manager: '',
    chatter: '',
    creator: '',
  };
  let creatorUserId = '';

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  const readings = (token: string | null, payload: object) =>
    server.inject({
      method: 'POST',
      url: '/v1/trends/readings',
      headers: token === null ? {} : { 'x-extension-link': token },
      payload,
    });
  const link = (creatorId: CreatorId, code = 'Cx1AbCdEf') => ({
    url: `https://www.instagram.com/reel/${code}/?igsh=partage`,
    text: 'Transition tenue en un claquement de doigts',
    format: 'reel',
    creatorId,
  });
  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;
  const reading = (over: Record<string, unknown> = {}) => ({
    code: 'Dq9ZyXwVu',
    path: 'post',
    account: 'compte.invente',
    metrics: { views: null, likes: 120, comments: 4 },
    caption: 'Une légende inventée',
    hashtags: ['tenue'],
    sound: null,
    soundId: null,
    dwellMs: 4000,
    markedFor: null,
    seenAt: '2026-11-03T10:00:00.000Z',
    ...over,
  });

  async function seedCreator(label: string): Promise<CreatorId> {
    const creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: label, timezone: 'Europe/Paris' });
    return creatorId;
  }

  async function member(email: string, teamRole: 'manager' | 'chatter'): Promise<string> {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    await test.admin.db.insert(schema.teamMembers).values({
      id: newId(TeamMemberIdSchema),
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `Membre ${teamRole}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return signIn(server, email, PASSWORD);
  }

  async function newToken(cookie: string): Promise<string> {
    const response = await call('POST', '/v1/trends/extension-link', cookie);
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    return ExtensionLinkCreatedSchema.parse(response.json()).token;
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    nora = await seedCreator('Nora');
    ines = await seedCreator('Ines');
    await createOwner(app.auth, app.db.db, OWNER);
    cookies.owner = await signIn(server, OWNER.email, OWNER.password);
    cookies.manager = await member('manager@example.test', 'manager');
    cookies.chatter = await member('chatter@example.test', 'chatter');
    const creator = await createOwner(app.auth, app.db.db, {
      email: 'nora@example.test',
      name: 'Nora',
      password: PASSWORD,
    });
    creatorUserId = creator.userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [nora] })
      .where(eq(schema.user.id, creatorUserId));
    cookies.creator = await signIn(server, 'nora@example.test', PASSWORD);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('keeps a pasted link once per creator, the address read by its form, for her only when she pastes it', async () => {
    const first = await call('POST', '/v1/trends/links', cookies.manager, link(nora));
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ created: true, url: 'https://www.instagram.com/reel/Cx1AbCdEf/' });
    // The same post by another path, pasted again: nothing added.
    const again = await call('POST', '/v1/trends/links', cookies.owner, {
      ...link(nora),
      url: 'https://instagram.com/reel/Cx1AbCdEf',
    });
    expect(again.json()).toEqual({
      created: false,
      url: 'https://www.instagram.com/reel/Cx1AbCdEf/',
      expiresAt: null,
    });
    expect(
      (await call('POST', '/v1/trends/links', cookies.chatter, link(ines, 'Cx2AbCdEf'))).statusCode,
    ).toBe(200);

    const hers = await call('POST', '/v1/trends/links', cookies.creator, link(nora, 'Cx3AbCdEf'));
    expect(hers.json()).toMatchObject({ created: true });
    const elsewhere = await call('POST', '/v1/trends/links', cookies.creator, link(ines, 'Cx4AbCdEf'));
    expect([elsewhere.statusCode, codeOf(elsewhere)]).toEqual([403, 'trend_link_forbidden']);
    const unknown = await call('POST', '/v1/trends/links', cookies.manager, link(newId(CreatorIdSchema)));
    expect([unknown.statusCode, codeOf(unknown)]).toEqual([403, 'trend_link_forbidden']);
    const notInstagram = await call('POST', '/v1/trends/links', cookies.manager, {
      ...link(nora),
      url: 'https://example.test/reel/Cx1AbCdEf/',
    });
    expect(notInstagram.statusCode).toBe(400);

    const rows = await test.admin.db
      .select({ source: schema.trendSignals.source, creatorId: schema.trendSignals.creatorId })
      .from(schema.trendSignals);
    expect(rows).toHaveLength(3);
    expect(rows.filter((row) => row.source === 'creator_link')).toEqual([
      { source: 'creator_link', creatorId: nora },
    ]);
  });

  it('links one extension per person, the token shown once and kept hashed, revoked by a new one or by her', async () => {
    expect((await call('GET', '/v1/trends/extension-link', cookies.creator)).json()).toEqual({ link: null });
    const token = await newToken(cookies.creator);
    const state = ExtensionLinkStateSchema.parse(
      (await call('GET', '/v1/trends/extension-link', cookies.creator)).json(),
    );
    expect(state.link).not.toBeNull();
    const [stored] = await test.admin.db
      .select({ tokenHash: schema.extensionLinks.tokenHash })
      .from(schema.extensionLinks)
      .where(eq(schema.extensionLinks.userId, creatorUserId));
    expect(stored?.tokenHash).not.toBe(token);

    const batch = { watchSession: newId(WatchSessionIdSchema), readings: [reading()] };
    expect((await readings(token, batch)).json()).toEqual({ accepted: 1 });
    const replaced = await newToken(cookies.creator);
    const stale = await readings(token, batch);
    expect([stale.statusCode, codeOf(stale)]).toEqual([401, 'extension_link_unauthenticated']);
    expect((await readings(replaced, batch)).statusCode).toBe(200);
    expect((await call('DELETE', '/v1/trends/extension-link', cookies.creator)).statusCode).toBe(204);
    expect((await readings(replaced, batch)).statusCode).toBe(401);

    const audited = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, creatorUserId), eq(schema.auditLog.entity, 'extension_link')));
    expect(audited.map((row) => row.action).sort()).toEqual([
      'extension_link.create',
      'extension_link.create',
      'extension_link.revoke',
      'extension_link.revoke',
    ]);
  });

  it('refuses a batch without a live link before reading its body', async () => {
    expect((await readings(null, { nonsense: true })).statusCode).toBe(401);
    expect((await readings('a'.repeat(43), { nonsense: true })).statusCode).toBe(401);
  });

  it('keeps one row per person, session and post: seen again by another path, its figures are updated', async () => {
    const token = await newToken(cookies.manager);
    const watchSession = newId(WatchSessionIdSchema);
    const first = await readings(token, { watchSession, readings: [reading()] });
    expect(first.json()).toEqual({ accepted: 1 });
    const later = await readings(token, {
      watchSession,
      readings: [
        reading({
          path: 'reel',
          metrics: { views: 9000, likes: 150, comments: null },
          dwellMs: 1000,
          markedFor: nora,
          seenAt: '2026-11-03T10:05:00.000Z',
        }),
      ],
    });
    expect(later.json()).toEqual({ accepted: 1 });
    const rows = await test.admin.db
      .select()
      .from(schema.trendReadings)
      .where(eq(schema.trendReadings.watchSessionId, watchSession));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      path: 'post',
      views: 9000,
      likes: 150,
      comments: 4,
      dwellMs: 4000,
      markedFor: nora,
      firstSeenAt: new Date('2026-11-03T10:00:00.000Z'),
      seenAt: new Date('2026-11-03T10:05:00.000Z'),
    });
    // A new session is a new row.
    expect(
      (await readings(token, { watchSession: newId(WatchSessionIdSchema), readings: [reading()] })).json(),
    ).toEqual({
      accepted: 1,
    });
  });

  it('refuses a mark for a creator the watcher may not mark for, writing nothing of the batch', async () => {
    const creatorToken = await newToken(cookies.creator);
    const watchSession = newId(WatchSessionIdSchema);
    const forOther = await readings(creatorToken, {
      watchSession,
      readings: [reading({ code: 'Aa1Bb2Cc3' }), reading({ code: 'Dd4Ee5Ff6', markedFor: ines })],
    });
    expect([forOther.statusCode, codeOf(forOther)]).toEqual([403, 'trend_reading_forbidden']);
    const ownerToken = await newToken(cookies.owner);
    const unknown = await readings(ownerToken, {
      watchSession,
      readings: [reading({ markedFor: newId(CreatorIdSchema) })],
    });
    expect(unknown.statusCode).toBe(403);
    const written = await test.admin.db
      .select()
      .from(schema.trendReadings)
      .where(eq(schema.trendReadings.watchSessionId, watchSession));
    expect(written).toHaveLength(0);
    const hers = await readings(creatorToken, { watchSession, readings: [reading({ markedFor: nora })] });
    expect(hers.json()).toEqual({ accepted: 1 });
  });

  it('opens no connection outward, neither for a pasted link nor for a batch of readings', async () => {
    const outward = [
      vi.spyOn(globalThis, 'fetch'),
      vi.spyOn(http, 'request'),
      vi.spyOn(http, 'get'),
      vi.spyOn(https, 'request'),
      vi.spyOn(https, 'get'),
      vi.spyOn(tls, 'connect'),
    ];
    const lookup = vi.spyOn(dns, 'lookup');
    const token = await newToken(cookies.owner);
    expect((await call('POST', '/v1/trends/links', cookies.owner, link(nora, 'Zz9Yy8Xx7'))).statusCode).toBe(
      200,
    );
    expect(
      (await readings(token, { watchSession: newId(WatchSessionIdSchema), readings: [reading()] }))
        .statusCode,
    ).toBe(200);
    for (const spy of outward) expect(spy).not.toHaveBeenCalled();
    // The base's own host only, if the pool opened a connection meanwhile.
    const base = new URL(test.appUrl).hostname;
    expect(lookup.mock.calls.map(([host]) => host).filter((host) => host !== base)).toEqual([]);
  });
});
