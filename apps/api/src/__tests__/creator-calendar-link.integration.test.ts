import {
  CalendarLinkCreatedSchema,
  CalendarLinkStateSchema,
  CreatorIdSchema,
  CreatorTaskIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { addDays, calendarDayIn, wallClockToInstant } from '../modules/scheduling/pure';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

/**
 * Her agenda in the calendar of her phone (CR-05 lot c2, ADR 0042 § 4, ADR 0045 § 5): her own link on the same table
 * as the team's, her tasks with hours or of a day in its feed, read with her rights. Invented data only (ADR 0010).
 */
describe('Lien de calendrier de la créatrice (CR-05 lot c2)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies = { nora: '', ines: '', owner: '' };
  const today = calendarDayIn(new Date(), PARIS);
  const at = (day: string, hour: number) => wallClockToInstant(day, hour * 60, PARIS).toISOString();

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    who: keyof typeof cookies,
    body?: object,
  ) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  /** As a calendar app asks: no cookie, no origin. */
  const feed = (path: string) => server.inject({ method: 'GET', url: path });

  const create = async (who: 'nora' | 'ines'): Promise<string> => {
    const response = await call('POST', '/v1/scheduling/calendar-link', who);
    expect(response.statusCode, response.body).toBe(201);
    return CalendarLinkCreatedSchema.parse(response.json()).path;
  };

  const addTask = async (who: 'nora' | 'ines', task: object) => {
    const response = await call('POST', '/v1/creator-space/tasks', who, {
      id: newId(CreatorTaskIdSchema),
      purpose: null,
      reminderMinutes: null,
      ...task,
    });
    expect(response.statusCode, response.body).toBe(200);
  };

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return signIn(server, email, PASSWORD);
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
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
    const { userId: ownerId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    // Who answers her fans tomorrow (ADR 0045 § 5): Kofi on Nora's Reveal account, Yao on Ines's.
    const tomorrow = addDays(today, 1);
    for (const [creatorId, name] of [
      [nora, 'Kofi'],
      [ines, 'Yao'],
    ] as const) {
      const accountId = newId(PlatformAccountIdSchema);
      await test.admin.db
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId, platform: 'reveal', handle: `${name}-compte` });
      const userId = newId(UserIdSchema);
      const memberId = newId(TeamMemberIdSchema);
      await test.admin.db.insert(schema.user).values({ id: userId, name, email: `${name}@example.test` });
      await test.admin.db.insert(schema.teamMembers).values({
        id: memberId,
        userId,
        teamRole: 'chatter',
        firstName: name,
        lastName: 'Inventé',
        displayName: name,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-09-01',
        status: 'active',
      });
      await test.admin.db.insert(schema.shifts).values({
        id: newId(ShiftIdSchema),
        creatorId,
        platformAccountId: accountId,
        memberId,
        startsAt: new Date(at(tomorrow, 18)),
        endsAt: new Date(at(tomorrow, 22)),
        createdBy: ownerId,
        updatedBy: ownerId,
      });
    }
    cookies.nora = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    cookies.ines = await account('ines@example.test', { role: 'creator', creatorIds: [ines] });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives her a link of her own, shown once, and never to the owner', async () => {
    const before = await call('GET', '/v1/scheduling/calendar-link', 'nora');
    expect(before.statusCode, before.body).toBe(200);
    expect(CalendarLinkStateSchema.parse(before.json()).link).toBeNull();
    const path = await create('nora');
    expect(path).toMatch(/^\/v1\/calendar-feed\/[\w-]{43}\.ics$/u);
    const after = CalendarLinkStateSchema.parse(
      (await call('GET', '/v1/scheduling/calendar-link', 'nora')).json(),
    );
    expect(after.link).not.toBeNull();
    expect(JSON.stringify(after)).not.toContain(path.slice(17, -4));
    expect((await call('POST', '/v1/scheduling/calendar-link', 'owner')).statusCode).toBe(403);
  });

  it('puts her tasks with hours and of a day in its feed, never a routine nor another creator’s', async () => {
    const tomorrow = addDays(today, 1);
    await addTask('nora', {
      when: { kind: 'timed', startsAt: at(tomorrow, 14), endsAt: at(tomorrow, 16) },
      category: 'shoot',
      title: 'Tournage robe rouge',
      purpose: 'Les photos du pack de vendredi',
    });
    await addTask('nora', {
      when: { kind: 'day', day: addDays(today, 2) },
      category: 'post',
      title: 'Post du soir',
    });
    await addTask('nora', {
      when: { kind: 'routine', weekdays: [1, 3, 5] },
      category: 'socials',
      title: 'Story',
    });
    await addTask('ines', { when: { kind: 'day', day: tomorrow }, category: 'live', title: 'Live d’Ines' });
    const path = await create('nora');
    const response = await feed(path);
    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(response.headers['cache-control']).toBe('private, no-store');
    const lines = response.body.split('\r\n');
    expect(lines).toContain('X-WR-CALNAME:Impera · mon agenda');
    expect(lines).toContain('SUMMARY:🎬 Tournage robe rouge');
    expect(lines).toContain('DESCRIPTION:Les photos du pack de vendredi');
    expect(lines).toContain(
      `DTSTART:${at(tomorrow, 14)
        .replace(/[-:]/gu, '')
        .replace(/\.\d{3}/u, '')}`,
    );
    expect(lines).toContain('SUMMARY:🖼️ Post du soir');
    expect(lines).toContain(`DTSTART;VALUE=DATE:${addDays(today, 2).replace(/-/gu, '')}`);
    expect(response.body).not.toContain('Story');
    expect(response.body).not.toContain('Ines');
    expect(lines.filter((line) => line === 'BEGIN:VEVENT')).toHaveLength(2);
  });

  it('answers the same 404 once she replaces or stops her link', async () => {
    const first = await create('ines');
    const second = await create('ines');
    expect((await feed(first)).statusCode).toBe(404);
    expect((await feed(second)).statusCode).toBe(200);
    expect((await call('DELETE', '/v1/scheduling/calendar-link', 'ines')).statusCode).toBe(204);
    const stopped = await feed(second);
    expect(stopped.statusCode).toBe(404);
    expect(stopped.json()).toMatchObject({ error: { code: 'calendar_feed_not_found' } });
  });

  it('adds who answers her fans when she chooses it, keeps her choice on a new address, and is hers alone', async () => {
    const path = await create('nora');
    const before = await feed(path);
    expect(before.body).not.toContain('répond à tes fans');
    expect(
      CalendarLinkStateSchema.parse((await call('GET', '/v1/scheduling/calendar-link', 'nora')).json()).link,
    ).toMatchObject({ withShifts: false });

    const chosen = await call('PATCH', '/v1/scheduling/calendar-link', 'nora', { withShifts: true });
    expect(chosen.statusCode, chosen.body).toBe(200);
    expect(CalendarLinkStateSchema.parse(chosen.json()).link).toMatchObject({ withShifts: true });
    const lines = (await feed(path)).body.split('\r\n');
    expect(lines).toContain('SUMMARY:👥 Kofi répond à tes fans');
    expect(lines).toContain('DESCRIPTION:Sur Reveal');
    // A chatter's time, never hers: the shift leaves her free in her calendar, her own slots stay busy.
    const shift = lines.indexOf('SUMMARY:👥 Kofi répond à tes fans');
    expect(lines.slice(shift, lines.indexOf('END:VEVENT', shift))).toContain('TRANSP:TRANSPARENT');
    const shoot = lines.indexOf('SUMMARY:🎬 Tournage robe rouge');
    expect(lines.slice(shoot, lines.indexOf('END:VEVENT', shoot))).toContain('TRANSP:OPAQUE');
    expect(lines).toContain(
      `DTSTART:${at(addDays(today, 1), 18)
        .replace(/[-:]/gu, '')
        .replace(/\.\d{3}/u, '')}`,
    );
    // Only a name in the team and a range: never another creator's shift, never a handle.
    expect(lines.join('\n')).not.toContain('Yao');
    expect(lines.join('\n')).not.toContain('Kofi-compte');

    const renewed = await create('nora');
    expect((await feed(renewed)).body).toContain('SUMMARY:👥 Kofi répond à tes fans');

    expect(
      (await call('PATCH', '/v1/scheduling/calendar-link', 'nora', { withShifts: false })).statusCode,
    ).toBe(200);
    expect((await feed(renewed)).body).not.toContain('répond à tes fans');

    expect(
      (await call('PATCH', '/v1/scheduling/calendar-link', 'owner', { withShifts: true })).statusCode,
    ).toBe(403);
    // Ines stopped her link above: there is nothing to choose for.
    const none = await call('PATCH', '/v1/scheduling/calendar-link', 'ines', { withShifts: true });
    expect(none.statusCode).toBe(404);
    expect(none.json()).toMatchObject({ error: { code: 'calendar_link_not_found' } });
  });
});
