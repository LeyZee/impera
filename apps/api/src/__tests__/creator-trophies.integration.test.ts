import {
  AgencySuggestionSchema,
  ContentDropIdSchema,
  ContentRequestIdSchema,
  CreatorIdSchema,
  CreatorTaskSchema,
  EventIdSchema,
  newId,
  SuggestionIdSchema,
  TeamMemberIdSchema,
  TrophyCaseSchema,
  type CreatorId,
  type TrophyCase,
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
 * The creator's game (ADR 0107, CRB-01): the job notes her medals and trophies from her ticks and her drops, once; she
 * reads her own case and marks her reveals; the owner and a manager who has her on his list read it on her profile; a
 * chatter, another creator and a manager without her never do. Days are read from today in Paris, so the test holds
 * any day. Invented data only (ADR 0010).
 */
describe('Trophées de la créatrice : gains notés une fois, sa vitrine, la lecture de l’agence (ADR 0107)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let noraUser = '';
  let ownerId = '';
  const cookies: Record<'nora' | 'ines' | 'owner' | 'manager' | 'stranger' | 'chatter', string> = {
    nora: '',
    ines: '',
    owner: '',
    manager: '',
    stranger: '',
    chatter: '',
  };
  const today = calendarDayIn(new Date(), PARIS);

  const call = (method: 'GET' | 'POST', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url: `/v1${url}`,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  const caseOf = async (url: string, who: keyof typeof cookies): Promise<TrophyCase> => {
    const response = await call('GET', url, who);
    expect(response.statusCode, response.body).toBe(200);
    return TrophyCaseSchema.parse(response.json());
  };
  const earned = (trophyCase: TrophyCase) =>
    trophyCase.items.filter((item) => item.earnedAt !== null).map((item) => item.kind);

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  /** A request of hers, and a drop she made from it that arrived on `arrivedOn` (noon, Paris), if any. */
  async function request(dueOn: string, arrivedOn: string | null) {
    const requestId = newId(ContentRequestIdSchema);
    await test.admin.db.insert(schema.contentRequests).values({
      id: requestId,
      creatorId: nora,
      category: 'feed_shoot',
      dueOn,
      reason: 'Une séance inventée',
      origin: 'agency',
      createdBy: ownerId,
    });
    if (arrivedOn === null) return;
    const dropId = newId(ContentDropIdSchema);
    await test.admin.db.insert(schema.contentDrops).values({
      id: dropId,
      creatorId: nora,
      category: 'feed_shoot',
      state: 'ready',
      requestId,
      createdBy: noraUser,
    });
    await test.admin.db.insert(schema.domainEvents).values({
      id: newId(EventIdSchema),
      creatorId: nora,
      type: 'content_drop_received',
      payload: { dropId, requestId },
      actor: 'system',
      correlationId: 'test',
      createdAt: wallClockToInstant(arrivedOn, 12 * 60, PARIS),
    });
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
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    }));
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const [who, teamRole, creatorIds] of [
      ['manager', 'manager', [nora, ines]],
      ['stranger', 'manager', [ines]],
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
    const her = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    noraUser = her.userId;
    cookies.nora = her.cookie;
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;

    // Her routine, the agency's, accepted: every day, essential. It entered her agenda ten days ago, and she ticked
    // it the eight days before today: a streak of eight, each day « parfaite » (the routine is all she had).
    const suggested = AgencySuggestionSchema.parse(
      (
        await call('POST', `/creators/${nora}/suggestions`, 'owner', {
          id: newId(SuggestionIdSchema),
          when: { kind: 'routine', weekdays: [1, 2, 3, 4, 5, 6, 7] },
          category: 'socials',
          title: 'Répondre aux commentaires',
        })
      ).json(),
    );
    const task = CreatorTaskSchema.parse(
      (await call('POST', `/creator-space/suggestions/${suggested.id}/accept`, 'nora', {})).json(),
    );
    await test.admin.db
      .update(schema.creatorTasks)
      .set({ createdAt: wallClockToInstant(addDays(today, -10), 8 * 60, PARIS) })
      .where(eq(schema.creatorTasks.id, task.id));
    for (let back = 8; back >= 1; back -= 1) {
      const day = addDays(today, -back);
      await test.admin.db.insert(schema.creatorTaskTicks).values({
        taskId: task.id,
        creatorId: nora,
        day,
        doneAt: wallClockToInstant(day, 18 * 60, PARIS),
        createdBy: noraUser,
      });
    }

    // Her requests: two delivered on time, one late, then one on time again; one still ahead.
    await request(addDays(today, -9), addDays(today, -9));
    await request(addDays(today, -7), addDays(today, -8));
    await request(addDays(today, -5), addDays(today, -4));
    await request(addDays(today, -3), addDays(today, -3));
    await request(addDays(today, 3), null);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('notes her medal, her first drop, her first on-time delivery and her perfect day, once', async () => {
    expect(earned(await caseOf('/creator-space/trophy-case', 'nora'))).toEqual([]);
    const first = await app.modules.rewards.jobs.evaluate();
    expect(first.gained).toBe(4);
    const again = await app.modules.rewards.jobs.evaluate();
    expect(again.gained).toBe(0);
    const trophyCase = await caseOf('/creator-space/trophy-case', 'nora');
    expect(earned(trophyCase)).toEqual([
      'day_streak_7',
      'first_drop',
      'first_on_time_delivery',
      'perfect_day',
    ]);
    expect(trophyCase.streaks).toEqual([
      { kind: 'day', current: 8, best: 8 },
      { kind: 'delivery', current: 1, best: 2 },
    ]);
    expect(trophyCase.items.find((item) => item.kind === 'day_streak_14')?.progress).toEqual({
      current: 8,
      target: 14,
      unit: 'day',
    });
    expect(trophyCase.level).toBeNull();
    // Ines did nothing: nothing of Nora's shows in her case.
    expect(earned(await caseOf('/creator-space/trophy-case', 'ines'))).toEqual([]);
  });

  it('marks the reveals she has just seen, hers only', async () => {
    const seen = await call('POST', '/creator-space/trophy-case/reveals', 'nora', {
      kinds: ['day_streak_7'],
    });
    expect(seen.statusCode, seen.body).toBe(200);
    const after = TrophyCaseSchema.parse(seen.json());
    expect(after.items.find((item) => item.kind === 'day_streak_7')?.revealedAt).not.toBeNull();
    expect(after.items.find((item) => item.kind === 'first_drop')?.revealedAt).toBeNull();
    // Ines marking Nora's kinds changes nothing of Nora's.
    expect(
      (await call('POST', '/creator-space/trophy-case/reveals', 'ines', { kinds: ['first_drop'] }))
        .statusCode,
    ).toBe(200);
    const nora = await caseOf('/creator-space/trophy-case', 'nora');
    expect(nora.items.find((item) => item.kind === 'first_drop')?.revealedAt).toBeNull();
  });

  it('shows her case on her profile to the owner and to a manager who has her, never to anyone else', async () => {
    const mine = await caseOf('/creator-space/trophy-case', 'nora');
    expect(await caseOf(`/creators/${nora}/trophy-case`, 'owner')).toEqual(mine);
    expect(await caseOf(`/creators/${nora}/trophy-case`, 'manager')).toEqual(mine);
    // A manager without her stops at the session's guard; a chatter who works for her reads none of it.
    expect((await call('GET', `/creators/${nora}/trophy-case`, 'stranger')).statusCode).toBe(403);
    expect((await call('GET', `/creators/${nora}/trophy-case`, 'chatter')).statusCode).toBe(404);
    for (const who of ['nora', 'ines'] as const)
      expect((await call('GET', `/creators/${nora}/trophy-case`, who)).statusCode).toBe(403);
    // Her own routes are hers: the team has none.
    for (const who of ['owner', 'manager', 'chatter'] as const)
      expect((await call('GET', '/creator-space/trophy-case', who)).statusCode).toBe(403);
    // And she has no chatter's case.
    expect((await call('GET', '/rewards/my-trophy-case', 'nora')).statusCode).toBe(403);
  });
});
