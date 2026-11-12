import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

import {
  CreatorIdSchema,
  ExtensionLinkCreatedSchema,
  ExtensionLinkCreatorsSchema,
  ExtensionLinkListSchema,
  newId,
  TeamMemberIdSchema,
  WatchSessionIdSchema,
  type CreatorId,
  type TrendCaptureDescription,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { LlmGateway } from '@impera/llm';
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
  const DESCRIPTION: TrendCaptureDescription = {
    hook: 'Un regard caméra puis un rire, dès la première seconde.',
    angles: ['plan serré visage'],
    onScreenText: null,
    editing: 'Un plan unique, sans coupe.',
  };
  /** What the vision answers next: a description, or the gateway's failure. */
  let visionFails: 'budget_reached' | 'trend_watch_budget_reached' | 'all_models_failed' | null = null;
  const describeTrendCaptures = vi.fn<LlmGateway['describeTrendCaptures']>(() =>
    Promise.resolve(
      visionFails === null
        ? {
            ok: true as const,
            value: {
              output: DESCRIPTION,
              meta: {
                provider: 'google' as const,
                model: 'vision',
                isFallback: false,
                latencyMs: 1,
                promptHash: 'h',
              },
            },
          }
        : { ok: false as const, error: { code: visionFails, attempts: [] } },
    ),
  );

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
  const readingsCreators = async (token: string) =>
    ExtensionLinkCreatorsSchema.parse(
      (
        await server.inject({
          method: 'GET',
          url: '/v1/trends/readings/creators',
          headers: { 'x-extension-link': token },
        })
      ).json(),
    ).items;
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

  async function newLink(cookie: string, label = 'Chrome') {
    const response = await call('POST', '/v1/trends/extension-links', cookie, { label });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    return ExtensionLinkCreatedSchema.parse(response.json());
  }
  const newToken = async (cookie: string, label?: string): Promise<string> =>
    (await newLink(cookie, label)).token;
  const liveLinks = async (cookie: string) =>
    ExtensionLinkListSchema.parse((await call('GET', '/v1/trends/extension-links', cookie)).json()).items;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), { trendVision: { describeTrendCaptures } });
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
    // A chatter never takes part in the watch (ADR 0060 § 2, amended 07/11).
    const byChatter = await call('POST', '/v1/trends/links', cookies.chatter, link(ines, 'Cx2AbCdEf'));
    expect([byChatter.statusCode, codeOf(byChatter)]).toEqual([403, 'trend_link_forbidden']);

    const hers = await call('POST', '/v1/trends/links', cookies.creator, link(nora, 'Cx3AbCdEf'));
    expect(hers.json()).toMatchObject({ created: true });
    // Pasted by the agency first: to her it is taken all the same, never « already there ».
    const afterAgency = await call('POST', '/v1/trends/links', cookies.creator, link(nora));
    expect(afterAgency.json()).toMatchObject({ created: true });
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
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.source === 'creator_link')).toEqual([
      { source: 'creator_link', creatorId: nora },
    ]);
  });

  it('links one extension per browser, the token shown once and kept hashed, three at most', async () => {
    expect(await liveLinks(cookies.creator)).toEqual([]);
    const chrome = await newLink(cookies.creator, 'Chrome');
    const edge = await newLink(cookies.creator, 'Edge');
    const [stored] = await test.admin.db
      .select({ tokenHash: schema.extensionLinks.tokenHash })
      .from(schema.extensionLinks)
      .where(eq(schema.extensionLinks.id, chrome.id));
    expect(stored?.tokenHash).not.toBe(chrome.token);

    // Chrome and Edge of one person both write: neither revokes the other.
    const batch = { watchSession: newId(WatchSessionIdSchema), readings: [reading()] };
    expect((await readings(chrome.token, batch)).json()).toEqual({ accepted: 1 });
    expect((await readings(edge.token, batch)).json()).toEqual({ accepted: 1 });
    const listed = await liveLinks(cookies.creator);
    expect(listed.map((one) => one.label)).toEqual(['Chrome', 'Edge']);
    expect(listed.every((one) => one.lastUsedAt !== null)).toBe(true);

    // The same browser linked again: its old link goes, the other stays.
    const chromeAgain = await newLink(cookies.creator, 'Chrome');
    const stale = await readings(chrome.token, batch);
    expect([stale.statusCode, codeOf(stale)]).toEqual([401, 'extension_link_unauthenticated']);
    expect((await readings(edge.token, batch)).statusCode).toBe(200);

    await newLink(cookies.creator, 'Portable');
    const full = await call('POST', '/v1/trends/extension-links', cookies.creator, { label: 'Quatrième' });
    expect([full.statusCode, codeOf(full)]).toEqual([409, 'extension_links_full_conflict']);

    expect((await call('DELETE', `/v1/trends/extension-links/${edge.id}`, cookies.creator)).statusCode).toBe(
      204,
    );
    expect((await readings(edge.token, batch)).statusCode).toBe(401);
    expect((await readings(chromeAgain.token, batch)).statusCode).toBe(200);
    // Another person's link, or one already revoked: not found.
    expect((await call('DELETE', `/v1/trends/extension-links/${edge.id}`, cookies.creator)).statusCode).toBe(
      404,
    );
    expect(
      (await call('DELETE', `/v1/trends/extension-links/${chromeAgain.id}`, cookies.owner)).statusCode,
    ).toBe(404);

    const audited = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.userId, creatorUserId), eq(schema.auditLog.entity, 'extension_link')));
    expect(audited.filter((row) => row.action === 'extension_link.create')).toHaveLength(4);
    expect(audited.filter((row) => row.action === 'extension_link.revoke')).toHaveLength(2);
    for (const one of await liveLinks(cookies.creator))
      await call('DELETE', `/v1/trends/extension-links/${one.id}`, cookies.creator);
  });

  it('never lets a chatter take part in the watch, nor a manager once he is one (ADR 0060 § 2, amended 07/11)', async () => {
    // A chatter links his browser for the copilot panel's writes only (ADR 0086 § 8): the watch's doors stay shut.
    const chatterToken = await newToken(cookies.chatter, 'Chrome');
    const shut = await server.inject({
      method: 'GET',
      url: '/v1/trends/readings/creators',
      headers: { 'x-extension-link': chatterToken },
    });
    expect([shut.statusCode, codeOf(shut)]).toEqual([403, 'trend_watch_forbidden']);
    expect((await readings(chatterToken, { readings: [] })).statusCode).toBe(403);

    // A manager links his browser, then becomes a chatter, then is away: his link no longer opens anything.
    const cookie = await member('futur-chatteur@example.test', 'manager');
    const token = await newToken(cookie, 'Edge');
    expect((await readingsCreators(token)).length).toBeGreaterThan(0);
    const [account] = await test.admin.db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, 'futur-chatteur@example.test'));
    if (account === undefined) throw new Error('no account');
    const memberOf = eq(schema.teamMembers.userId, account.id);
    await test.admin.db.update(schema.teamMembers).set({ teamRole: 'chatter' }).where(memberOf);
    const asChatter = await server.inject({
      method: 'GET',
      url: '/v1/trends/readings/creators',
      headers: { 'x-extension-link': token },
    });
    expect([asChatter.statusCode, codeOf(asChatter)]).toEqual([403, 'trend_watch_forbidden']);
    const paste = await call('POST', '/v1/trends/links', cookie, link(nora, 'Cx9AbCdEf'));
    expect([paste.statusCode, codeOf(paste)]).toEqual([403, 'trend_link_forbidden']);
    await test.admin.db
      .update(schema.teamMembers)
      .set({ teamRole: 'manager', status: 'on_leave' })
      .where(memberOf);
    // Away, his link names nobody any more, for the watch as for the panel.
    const away = await server.inject({
      method: 'GET',
      url: '/v1/trends/readings/creators',
      headers: { 'x-extension-link': token },
    });
    expect(away.statusCode).toBe(401);
  });

  it('tells the extension which creators its person may mark a post for', async () => {
    // An archived creator is out of every list (ADR 0071 § 2, recette EXT-09): never offered, never marked for.
    const archived = await seedCreator('Zoé');
    await test.admin.db
      .update(schema.creators)
      .set({ archivedAt: new Date() })
      .where(eq(schema.creators.id, archived));
    const hers = await readingsCreators(await newToken(cookies.creator));
    expect(hers.map((creator) => creator.id)).toEqual([nora]);
    const agency = await readingsCreators(await newToken(cookies.manager));
    expect(agency.map((creator) => creator.displayName)).toEqual(['Ines', 'Nora']);
    const without = await server.inject({ method: 'GET', url: '/v1/trends/readings/creators' });
    expect(without.statusCode).toBe(401);
  });

  it('forgets a link nobody used for 30 days, counted from its last use (audit du 11/11)', async () => {
    const statusOf = async (token: string) =>
      (
        await server.inject({
          method: 'GET',
          url: '/v1/trends/readings/creators',
          headers: { 'x-extension-link': token },
        })
      ).statusCode;
    const days = (count: number) => new Date(Date.now() - count * 24 * 3_600_000);
    const idle = await newLink(cookies.manager, 'Oublié');
    const used = await newLink(cookies.manager, 'Servi');
    const links = schema.extensionLinks;
    await test.admin.db
      .update(links)
      .set({ createdAt: days(31) })
      .where(eq(links.id, idle.id));
    await test.admin.db
      .update(links)
      .set({ createdAt: days(90), lastUsedAt: days(29) })
      .where(eq(links.id, used.id));
    expect(await statusOf(idle.token)).toBe(401);
    expect(await statusOf(used.token)).toBe(200);
    const listed = (await liveLinks(cookies.manager)).map((one) => one.label);
    expect(listed).toContain('Servi');
    expect(listed).not.toContain('Oublié');
    await call('DELETE', `/v1/trends/extension-links/${used.id}`, cookies.manager);
  });

  it('asks for the password and a code again before a new link, once the sign-in is over 10 minutes old', async () => {
    const stale = sql`now() - interval '11 minutes'`;
    await test.admin.db.update(schema.session).set({ reauthenticatedAt: stale });
    try {
      const refused = await call('POST', '/v1/trends/extension-links', cookies.manager, { label: 'Tardif' });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: 'reauthentication_forbidden' } });
      expect((await liveLinks(cookies.manager)).map((item) => item.label)).not.toContain('Tardif');
      // Seeing and unlinking stay open: closing a door never waits for a confirmation.
      expect((await call('GET', '/v1/trends/extension-links', cookies.manager)).statusCode).toBe(200);
    } finally {
      await test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now()` });
    }
  });

  it('takes a person’s links with the other sessions she closes (audit du 11/11)', async () => {
    const token = await newToken(cookies.manager, 'Avant');
    expect(await readingsCreators(token)).not.toHaveLength(0);
    const closed = await call('POST', '/v1/auth/sessions/close-others', cookies.manager);
    expect(closed.statusCode).toBe(200);
    const refused = await server.inject({
      method: 'GET',
      url: '/v1/trends/readings/creators',
      headers: { 'x-extension-link': token },
    });
    expect(refused.statusCode).toBe(401);
    expect(await liveLinks(cookies.manager)).toEqual([]);
    // Her session is the one she closed the others from: it stays, and she links her browser again.
    expect(await readingsCreators(await newToken(cookies.manager, 'Après'))).not.toHaveLength(0);
    for (const one of await liveLinks(cookies.manager))
      await call('DELETE', `/v1/trends/extension-links/${one.id}`, cookies.manager);
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
    expect(forOther.json()).toMatchObject({ error: { details: { creatorIds: [ines] } } });
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

  it('describes the captures of a marked post, keeps only the description, and nothing of an unmarked one', async () => {
    const token = await newToken(cookies.manager, 'Edge');
    const watchSession = newId(WatchSessionIdSchema);
    await readings(token, {
      watchSession,
      readings: [reading({ code: 'Mk1Mk2Mk3', markedFor: nora }), reading({ code: 'Nm1Nm2Nm3' })],
    });
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');
    const captures = (code: string, over: Record<string, unknown> = {}, linkToken: string | null = token) =>
      server.inject({
        method: 'POST',
        url: '/v1/trends/readings/captures',
        headers: linkToken === null ? {} : { 'x-extension-link': linkToken },
        payload: {
          watchSession,
          code,
          durationS: 14,
          captures: [{ mediaType: 'image/jpeg', data: jpeg }],
          ...over,
        },
      });
    describeTrendCaptures.mockClear();

    const described = await captures('Mk1Mk2Mk3');
    expect([described.statusCode, described.json()]).toEqual([200, { description: DESCRIPTION }]);
    const [input] = describeTrendCaptures.mock.calls[0] ?? [];
    expect(input?.trace).toEqual({ creatorId: nora });
    expect(input?.durationS).toBe(14);
    expect([...(input?.captures[0]?.data ?? [])]).toEqual([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const [row] = await test.admin.db
      .select({ description: schema.trendReadings.captureDescription })
      .from(schema.trendReadings)
      .where(
        and(
          eq(schema.trendReadings.watchSessionId, watchSession),
          eq(schema.trendReadings.postCode, 'Mk1Mk2Mk3'),
        ),
      );
    expect(row?.description).toEqual(DESCRIPTION);

    // Unmarked, unknown, or another person's reading: nothing for the vision.
    const owner = await newToken(cookies.owner, 'Firefox');
    for (const refused of [
      await captures('Nm1Nm2Nm3'),
      await captures('Zz0Zz0Zz0'),
      await captures('Mk1Mk2Mk3', {}, owner),
    ])
      expect([refused.statusCode, codeOf(refused)]).toEqual([404, 'trend_capture_reading_not_found']);
    expect(describeTrendCaptures).toHaveBeenCalledTimes(1);

    // The watch's cap or the daily one: 429 until midnight; no model: 503. Nothing is written.
    visionFails = 'trend_watch_budget_reached';
    const spent = await captures('Mk1Mk2Mk3');
    expect([spent.statusCode, codeOf(spent)]).toEqual([429, 'trend_watch_budget_limited']);
    // Until midnight in Paris, never more than a day.
    const wait = Number(spent.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(25 * 3_600);
    visionFails = 'budget_reached';
    expect((await captures('Mk1Mk2Mk3')).statusCode).toBe(429);
    visionFails = 'all_models_failed';
    const down = await captures('Mk1Mk2Mk3');
    expect([down.statusCode, codeOf(down)]).toEqual([503, 'trend_capture_vision_unavailable']);
    visionFails = null;

    // Five captures, or none, are refused; without a link, 401 before the body.
    const five = Array.from({ length: 5 }, () => ({ mediaType: 'image/jpeg', data: jpeg }));
    expect((await captures('Mk1Mk2Mk3', { captures: five })).statusCode).toBe(400);
    expect((await captures('Mk1Mk2Mk3', { captures: [] })).statusCode).toBe(400);
    expect((await captures('Mk1Mk2Mk3', {}, null)).statusCode).toBe(401);
    expect(describeTrendCaptures).toHaveBeenCalledTimes(4);
  });

  it('takes four captures of full size, past the server’s 1 MiB', async () => {
    const token = await newToken(cookies.creator, 'Chrome');
    const watchSession = newId(WatchSessionIdSchema);
    await readings(token, { watchSession, readings: [reading({ code: 'Bg1Bg2Bg3', markedFor: nora })] });
    const big = Buffer.alloc(700_000, 7).toString('base64');
    const response = await server.inject({
      method: 'POST',
      url: '/v1/trends/readings/captures',
      headers: { 'x-extension-link': token },
      payload: {
        watchSession,
        code: 'Bg1Bg2Bg3',
        durationS: null,
        captures: Array.from({ length: 4 }, () => ({ mediaType: 'image/webp', data: big })),
      },
    });
    expect(response.statusCode, response.body).toBe(200);
    const tooBig = Buffer.alloc(800_000, 7).toString('base64');
    const refused = await server.inject({
      method: 'POST',
      url: '/v1/trends/readings/captures',
      headers: { 'x-extension-link': token },
      payload: {
        watchSession,
        code: 'Bg1Bg2Bg3',
        durationS: null,
        captures: [{ mediaType: 'image/webp', data: tooBig }],
      },
    });
    expect(refused.statusCode).toBe(400);
    // A refused body is never echoed back.
    expect(refused.body).not.toContain(tooBig.slice(0, 64));
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

  it('counts a wrong token against the limit of the extension’s doors', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 40; i += 1)
      statuses.push((await readings('b'.repeat(43), { watchSession: 'x', readings: [] })).statusCode);
    expect(statuses).toContain(429);
    expect(statuses.slice(0, statuses.indexOf(429)).every((status) => status === 401)).toBe(true);
  });
});
