import {
  ApiErrorSchema,
  CalendarLinkCreatedSchema,
  CalendarLinkStateSchema,
  newId,
  PlatformAccountIdSchema,
  TeamMemberSchema,
  type CreatorId,
  type PlatformAccountId,
  type TeamMember,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { iso, parisDay, parisInstant } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

/** Invented people, creators and accounts only (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'staple battery horse';

describe('Lien de calendrier (CR-12, ADR 0045 § 5)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  const sink = new LogSink();
  let owner: string;
  let anna: CreatorId;
  let ines: CreatorId;
  let annaAccount: PlatformAccountId;
  let inesAccount: PlatformAccountId;
  let theo: TeamMember;
  let basile: TeamMember;
  let theoCookie: string;
  let basileCookie: string;
  const day = parisDay(1);

  const link = (method: 'GET' | 'POST' | 'DELETE', cookie: string) =>
    server.inject({
      method,
      url: '/v1/scheduling/calendar-link',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });

  const create = async (cookie: string): Promise<string> => {
    const response = await link('POST', cookie);
    expect(response.statusCode, response.body).toBe(201);
    return CalendarLinkCreatedSchema.parse(response.json()).path;
  };

  /** As a calendar app asks: no cookie, no origin. */
  const feed = (path: string) => server.inject({ method: 'GET', url: path });

  const addMember = async (email: string, displayName: string, creatorIds: CreatorId[]) => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/team/members',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        email,
        displayName,
        teamRole: 'chatter',
        creatorIds,
        firstName: displayName,
        lastName: 'Inventé',
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: parisDay(-30),
        commission: { rateBps: 1000 },
        teamShareBps: null,
      },
    });
    expect(response.statusCode).toBe(201);
    const member = TeamMemberSchema.parse(response.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: member.userId,
      providerId: 'credential',
      accountId: member.userId,
      password: await context.password.hash(PASSWORD),
    });
    return { member, cookie: await signIn(server, email, PASSWORD) };
  };

  const addShift = async (
    memberId: string,
    creatorId: string,
    accountId: string,
    start: number,
    end: number,
  ) => {
    const response = await server.inject({
      method: 'POST',
      url: '/v1/scheduling/shifts',
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      payload: {
        memberId,
        creatorId,
        platformAccountId: accountId,
        startsAt: iso(parisInstant(day, start)),
        endsAt: iso(parisInstant(day, end)),
      },
    });
    expect(response.statusCode, response.body).toBe(201);
  };

  const setStatus = (member: TeamMember, status: 'active' | 'sick' | 'left') =>
    test.admin.db
      .update(schema.teamMembers)
      .set(status === 'left' ? { status, leftOn: parisDay() } : { status, leftOn: null })
      .where(eq(schema.teamMembers.id, member.id));

  const expectRefused = (response: { statusCode: number; json: () => unknown }) => {
    expect(response.statusCode).toBe(404);
    const body = ApiErrorSchema.parse(response.json());
    expect([body.error.code, body.error.message]).toEqual([
      'calendar_feed_not_found',
      'Ce lien de calendrier n’est plus valable',
    ]);
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      LOG_LEVEL: 'info',
    });
    const logger = createLogger(config, sink);
    app = await createApp(config, logger);
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
    ines = (await app.modules.persona.creators.create({ displayName: 'Inès' })).id;
    annaAccount = newId(PlatformAccountIdSchema);
    inesAccount = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values([
      { id: annaAccount, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
      { id: inesAccount, creatorId: ines, platform: 'reveal', handle: 'ines-inventee' },
    ]);
    owner = await signIn(server, OWNER.email, OWNER.password);
    ({ member: theo, cookie: theoCookie } = await addMember('theo@example.test', 'Théo', [anna]));
    ({ member: basile, cookie: basileCookie } = await addMember('basile@example.test', 'Basile', [
      anna,
      ines,
    ]));
    await addShift(theo.id, anna, annaAccount, 600, 840);
    await addShift(basile.id, ines, inesAccount, 1200, 1380);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives a member his own shifts only, as an iCalendar file nobody caches, the token kept nowhere in clear', async () => {
    expect(CalendarLinkStateSchema.parse((await link('GET', theoCookie)).json())).toEqual({ link: null });
    const path = await create(theoCookie);
    const token = path.slice('/v1/calendar-feed/'.length, -'.ics'.length);
    expect(CalendarLinkStateSchema.parse((await link('GET', theoCookie)).json()).link).not.toBeNull();

    const response = await feed(path);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(response.headers['cache-control']).toBe('private, no-store');
    const body = response.body;
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(body.endsWith('END:VCALENDAR\r\n')).toBe(true);
    // Théo, an active chatter, reads the whole team in the app; his link carries his own shift alone.
    expect(body.match(/BEGIN:VEVENT/gu)).toHaveLength(1);
    expect(body).toContain('SUMMARY:Shift · Anna');
    expect(body).toContain('DESCRIPTION:Théo sur Anna');
    expect(body).toContain(`DTSTART:${iso(parisInstant(day, 600)).replace(/[-:]/gu, '')}`);
    expect(body).not.toContain('Basile');
    expect(body).not.toContain('Inès');

    const rows = await test.admin.db.select().from(schema.calendarLinks);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
    // The request line never reaches the logs.
    expect(JSON.stringify(sink.lines)).not.toContain(token);
  });

  it('keeps the application role out of the table', async () => {
    const failure: unknown = await app.db.db.execute(sql`select count(*) from calendar_links`).then(
      () => null,
      (error: unknown) => error,
    );
    const cause = failure instanceof Error && failure.cause instanceof Error ? failure.cause.message : '';
    expect(cause).toMatch(/permission denied/u);
  });

  it('revokes the address before when a new one is made, and stops one revoked, as an unknown one', async () => {
    const first = await create(basileCookie);
    const second = await create(basileCookie);
    expectRefused(await feed(first));
    expect((await feed(second)).statusCode).toBe(200);
    const deleted = await link('DELETE', basileCookie);
    expect(deleted.statusCode).toBe(204);
    expect(CalendarLinkStateSchema.parse((await link('GET', basileCookie)).json())).toEqual({ link: null });
    expectRefused(await feed(second));
    expectRefused(await feed(`/v1/calendar-feed/${'A'.repeat(43)}.ics`));
    expectRefused(await feed('/v1/calendar-feed/court.ics'));
    expectRefused(await feed(second.replace('.ics', '.txt')));
    const actions = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'calendar_link'));
    expect(actions.map((row) => row.action).toSorted()).toEqual(
      [
        'calendar_link.create',
        'calendar_link.create',
        'calendar_link.create',
        'calendar_link.revoke',
        'calendar_link.revoke',
      ].toSorted(),
    );
  });

  it('keeps a member off duty on his own shifts, and stops the link of one who left', async () => {
    const path = await create(basileCookie);
    await setStatus(basile, 'sick');
    const sick = await feed(path);
    expect(sick.statusCode).toBe(200);
    expect(sick.body).toContain('DESCRIPTION:Basile sur Inès');
    expect(sick.body.match(/BEGIN:VEVENT/gu)).toHaveLength(1);
    await setStatus(basile, 'left');
    expectRefused(await feed(path));
    await setStatus(basile, 'active');
  });

  it('is for the team: the owner has no shifts to send', async () => {
    expect((await link('POST', owner)).statusCode).toBe(403);
  });
});
