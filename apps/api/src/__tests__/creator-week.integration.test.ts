import { randomUUID } from 'node:crypto';

import {
  AgencyCreatorWeekSchema,
  ContentDropIdSchema,
  ContentRequestIdSchema,
  CreatorIdSchema,
  CreatorWeekSchema,
  newId,
  TeamMemberIdSchema,
  type AgencyCreatorWeek,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema, withTenantMember } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from '../modules/scheduling/pure';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

/**
 * Her week (ADR 0140): computed by the job on her real stock and scripts asked, read and validated by the owner only,
 * accepted by her in one gesture, its lines ticked by her, her delivery counted by her drops. The week is two weeks
 * ahead of today in Paris, so the test holds any day. Invented data only (ADR 0010).
 */
describe('her week: computed, validated by the owner, accepted and ticked by her', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  let ownerId = '';
  let noraUserId = '';
  let managerUserId = '';
  const cookies: Record<'nora' | 'ines' | 'owner' | 'manager' | 'chatter', string> = {
    nora: '',
    ines: '',
    owner: '',
    manager: '',
    chatter: '',
  };
  const today = calendarDayIn(new Date(), PARIS);
  // The Monday after next: its Sunday evening before is still ahead, and every day of it too.
  const week = addDays(today, 15 - isoWeekday(today));
  const sundayEvening = wallClockToInstant(addDays(week, -1), 19 * 60, PARIS);
  const requestId = newId(ContentRequestIdSchema);

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
  }

  const drop = (creatorId: CreatorId, category: string, state: string, createdAt: Date, request?: string) =>
    test.admin.db.insert(schema.contentDrops).values({
      id: newId(ContentDropIdSchema),
      creatorId,
      category,
      state,
      requestId: request ?? null,
      createdBy: noraUserId,
      createdAt,
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
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
    ownerId = (
      await createOwner(app.auth, app.db.db, {
        email: 'owner@example.test',
        name: 'Owner',
        password: PASSWORD,
      })
    ).userId;
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const teamRole of ['manager', 'chatter'] as const) {
      const member = await account(`${teamRole}@example.test`, {
        role: 'operator',
        creatorIds: [nora, ines],
      });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: member.userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
      cookies[teamRole] = member.cookie;
      if (teamRole === 'manager') managerUserId = member.userId;
    }
    const noraAccount = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    noraUserId = noraAccount.userId;
    cookies.nora = noraAccount.cookie;
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;

    // A script asked of her, due in the week, and the stock: one boudoir session, two stories, one already out.
    const structureId = randomUUID();
    await test.admin.db.insert(schema.scriptStructures).values({ id: structureId, createdBy: ownerId });
    const [version] = await test.admin.db
      .insert(schema.scriptStructureVersions)
      .values({
        id: randomUUID(),
        structureId,
        version: 1,
        name: 'La bougie',
        moment: 'night',
        segments: [
          {
            kind: 'stage',
            key: 'bougie',
            name: 'Bougie',
            intention: 'Elle allume la bougie',
            access: 'paid',
            mood: null,
            outfit: null,
            place: null,
            mediaSlots: [{ kind: 'image', optional: false, hint: null }],
            variants: [],
          },
        ],
        updatedBy: ownerId,
      })
      .returning({ id: schema.scriptStructureVersions.id });
    await test.admin.db.insert(schema.contentRequests).values({
      id: requestId,
      creatorId: nora,
      category: 'script',
      dueOn: addDays(week, 2),
      reason: 'Ton prochain script : la bougie',
      structureId,
      structureVersionId: version?.id ?? null,
      origin: 'cadence',
    });
    await drop(nora, 'feed_shoot', 'ready', new Date());
    await drop(nora, 'reveal_story', 'received', new Date());
    await drop(nora, 'reveal_story', 'ready', new Date());
    await test.admin.db.insert(schema.contentDrops).values({
      id: newId(ContentDropIdSchema),
      creatorId: nora,
      category: 'reveal_story',
      state: 'ready',
      createdBy: noraUserId,
      exportedAt: new Date(),
      exportedBy: ownerId,
    });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const draft = async (who: 'owner' | 'manager' = 'owner'): Promise<AgencyCreatorWeek> => {
    const response = await call('GET', `/v1/creators/${nora}/weeks/${week}`, who);
    expect(response.statusCode, response.body).toBe(200);
    return AgencyCreatorWeekSchema.parse(response.json());
  };

  const herWeek = async (who: 'nora' | 'ines' = 'nora') => {
    const response = await call('GET', `/v1/creator-space/week?week=${addDays(week, 3)}`, who);
    expect(response.statusCode, response.body).toBe(200);
    return CreatorWeekSchema.parse(response.json());
  };

  it('computes nothing before her Sunday 18 h, then the week after on her real stock', async () => {
    expect(
      await app.modules.creatorWeek.jobs.plan(new Date(sundayEvening.getTime() - 2 * 3_600_000)),
    ).toEqual({
      outcomes: {},
      failed: [],
    });
    expect((await call('GET', `/v1/creators/${nora}/weeks/${week}`, 'owner')).statusCode).toBe(404);
    expect(await app.modules.creatorWeek.jobs.plan(sundayEvening)).toEqual({
      outcomes: { written: 2 },
      failed: [],
    });
    const computed = await draft();
    expect(computed.state).toBe('draft');
    // No dispo, no week before: Wednesday and Saturday.
    expect(computed.plan.shootDays.map((day) => day.day)).toEqual([addDays(week, 2), addDays(week, 5)]);
    expect(computed.plan.stock).toEqual({ sessions: 1, videos: 0, stories: 2 });
    const lines = computed.plan.shootDays.flatMap((day) => day.items);
    expect(lines.map((line) => [line.need, line.count])).toEqual(
      expect.arrayContaining([
        ['script', 1],
        ['feed_shoot', 1],
      ]),
    );
    // Two boudoir sessions of the three (one in stock), seven videos of the day.
    expect(lines.filter((line) => line.need === 'feed_shoot')).toHaveLength(2);
    expect(
      lines.filter((line) => line.need === 'feed_video').reduce((sum, line) => sum + line.count, 0),
    ).toBe(7);
    expect(lines.find((line) => line.need === 'script')).toMatchObject({
      label: 'Script « La bougie »',
      requestId,
    });
    expect(
      lines.filter((line) => line.need === 'reveal_story').reduce((sum, line) => sum + line.count, 0),
    ).toBe(5);
    expect(computed.plan.deferred).toEqual([]);
    expect(computed.plan.dueAt).toBe(wallClockToInstant(addDays(week, 6), 23 * 60, PARIS).toISOString());
    // Replayed in the same evening: refreshed, never doubled.
    expect(await app.modules.creatorWeek.jobs.plan(new Date(sundayEvening.getTime() + 3_600_000))).toEqual({
      outcomes: { refreshed: 2 },
      failed: [],
    });
    expect(await test.admin.db.select().from(schema.creatorWeeks)).toHaveLength(2);
  });

  it('is read by her team, never by a chatter nor by her; validated by the owner alone', async () => {
    expect((await draft('manager')).state).toBe('draft');
    for (const who of ['chatter', 'nora'] as const)
      expect((await call('GET', `/v1/creators/${nora}/weeks/${week}`, who)).statusCode).toBe(403);
    const { plan } = await draft();
    expect(
      (await call('POST', `/v1/creators/${nora}/weeks/${week}/validate`, 'manager', { plan })).statusCode,
    ).toBe(403);
    // Not even under her team's rights in the base: the owner's update only.
    const touched = await withTenantMember(app.db.db, nora, managerUserId, (tx) =>
      tx
        .update(schema.creatorWeeks)
        .set({ state: 'validated', validatedBy: managerUserId, validatedAt: new Date() })
        .where(eq(schema.creatorWeeks.week, week))
        .returning(),
    );
    expect(touched).toEqual([]);
    // Nothing reaches her before the owner validates.
    expect(await herWeek()).toEqual({ week, toAccept: false, shootDays: [], delivery: null });
  });

  it('takes the owner’s corrections, refuses a day outside the week, answers a replay and refuses another plan', async () => {
    const { plan } = await draft();
    const outside = {
      ...plan,
      shootDays: plan.shootDays.map((day, index) => (index === 0 ? { ...day, day: addDays(week, 7) } : day)),
    };
    const refused = await call('POST', `/v1/creators/${nora}/weeks/${week}/validate`, 'owner', {
      plan: outside,
    });
    expect(refused.statusCode, refused.body).toBe(422);
    expect(refused.json()).toMatchObject({ error: { code: 'creator_week_plan_unprocessable' } });
    // He moves Saturday to Friday and drops the video.
    const corrected = {
      ...plan,
      shootDays: plan.shootDays.map((day, index) =>
        index === 1
          ? { day: addDays(week, 4), items: day.items.filter((item) => item.need !== 'feed_video') }
          : { ...day, items: day.items.filter((item) => item.need !== 'feed_video') },
      ),
    };
    const validated = await call('POST', `/v1/creators/${nora}/weeks/${week}/validate`, 'owner', {
      plan: corrected,
    });
    expect(validated.statusCode, validated.body).toBe(200);
    expect(AgencyCreatorWeekSchema.parse(validated.json())).toMatchObject({ state: 'validated' });
    const again = await call('POST', `/v1/creators/${nora}/weeks/${week}/validate`, 'owner', {
      plan: corrected,
    });
    expect(again.statusCode, again.body).toBe(200);
    const other = await call('POST', `/v1/creators/${nora}/weeks/${week}/validate`, 'owner', { plan });
    expect(other.statusCode).toBe(409);
    expect(other.json()).toMatchObject({ error: { code: 'creator_week_validated_conflict' } });
    // The job leaves a validated week alone.
    expect(
      (await app.modules.creatorWeek.jobs.plan(new Date(sundayEvening.getTime() + 2 * 3_600_000))).outcomes,
    ).toEqual({
      validated: 1,
      refreshed: 1,
    });
    const frames = await test.admin.db
      .select()
      .from(schema.creatorSuggestions)
      .where(eq(schema.creatorSuggestions.creatorId, nora));
    expect(frames.map((frame) => [frame.weekRole, frame.day]).sort()).toEqual([
      ['delivery', addDays(week, 6)],
      ['shoot_day', addDays(week, 2)],
      ['shoot_day', addDays(week, 4)],
    ]);
    // A line of her shooting day is the owner's alone to write: a manager under her own account is refused.
    const shootDay = frames.find((frame) => frame.weekRole === 'shoot_day');
    if (shootDay === undefined) throw new Error('a shooting day expected');
    await expect(
      withTenantMember(app.db.db, nora, managerUserId, (tx) =>
        tx.insert(schema.creatorShootItems).values({
          id: randomUUID(),
          creatorId: nora,
          suggestionId: shootDay.id,
          position: 19,
          need: 'feed_shoot',
          label: 'Ligne glissée par un manager',
          sheet: null,
          count: 1,
          requestId: null,
          createdBy: managerUserId,
        }),
      ),
      // 42501: the row breaks her team_insert policy.
    ).rejects.toMatchObject({ cause: { code: '42501' } });
  });

  it('reaches her as her week to accept, and no one else’s', async () => {
    const mine = await herWeek();
    expect(mine.toAccept).toBe(true);
    expect(mine.shootDays.map((day) => [day.day, day.state])).toEqual([
      [addDays(week, 2), 'suggested'],
      [addDays(week, 4), 'suggested'],
    ]);
    expect(mine.shootDays.flatMap((day) => day.items).some((item) => item.need === 'feed_video')).toBe(false);
    expect(mine.delivery).toMatchObject({ state: 'suggested', delivered: false });
    expect(await herWeek('ines')).toEqual({ week, toAccept: false, shootDays: [], delivery: null });
    for (const who of ['owner', 'manager'] as const)
      expect((await call('GET', `/v1/creator-space/week?week=${week}`, who)).statusCode).toBe(403);
  });

  it('lets her tick a line only once she accepted its day, and accepts her week in one gesture, replayable', async () => {
    const line = (await herWeek()).shootDays[0]?.items[0];
    expect(line).toBeDefined();
    const early = await call('PUT', `/v1/creator-space/shoot-items/${line?.id ?? ''}`, 'nora', {
      done: true,
    });
    expect(early.statusCode, early.body).toBe(422);
    expect(early.json()).toMatchObject({ error: { code: 'shoot_item_not_accepted_unprocessable' } });
    const accepted = await call('POST', '/v1/creator-space/week/accept', 'nora', { week });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toEqual({ accepted: 3 });
    expect((await call('POST', '/v1/creator-space/week/accept', 'nora', { week })).json()).toEqual({
      accepted: 0,
    });
    const mine = await herWeek();
    expect(mine.toAccept).toBe(false);
    expect(mine.shootDays.every((day) => day.state === 'accepted' && day.taskId !== null)).toBe(true);
    expect(mine.delivery?.state).toBe('accepted');
  });

  it('ticks the day’s task once every line is shot, and takes it back with a line', async () => {
    const [first] = (await herWeek()).shootDays;
    if (first?.taskId == null) throw new Error('no first day');
    const tick = (id: string, done: boolean, who: 'nora' | 'ines' = 'nora') =>
      call('PUT', `/v1/creator-space/shoot-items/${id}`, who, { done });
    expect((await tick(first.items[0]?.id ?? '', true, 'ines')).statusCode).toBe(404);
    for (const item of first.items) expect((await tick(item.id, true)).statusCode).toBe(204);
    // A double tap changes nothing.
    expect((await tick(first.items[0]?.id ?? '', true)).statusCode).toBe(204);
    const ticksOf = () =>
      test.admin.db
        .select()
        .from(schema.creatorTaskTicks)
        .where(
          and(
            eq(schema.creatorTaskTicks.taskId, first.taskId ?? ''),
            eq(schema.creatorTaskTicks.day, first.day),
          ),
        );
    expect(await ticksOf()).toHaveLength(1);
    expect((await herWeek()).shootDays[0]?.items.every((item) => item.done)).toBe(true);
    expect((await tick(first.items[0]?.id ?? '', false)).statusCode).toBe(204);
    expect(await ticksOf()).toHaveLength(0);
  });

  it('counts her delivery by the drops that arrived in the week, and her script by its request', async () => {
    const before = (await herWeek()).delivery;
    expect(before?.lines.find((line) => line.need === 'script')).toEqual({
      need: 'script',
      asked: 1,
      received: 0,
    });
    const inWeek = wallClockToInstant(addDays(week, 3), 10 * 60, PARIS);
    await drop(nora, 'feed_shoot', 'received', inWeek);
    await drop(nora, 'script', 'received', inWeek, requestId);
    // Before her Monday: not this week's delivery.
    await drop(
      nora,
      'reveal_story',
      'received',
      new Date(wallClockToInstant(week, 0, PARIS).getTime() - 60_000),
    );
    const after = (await herWeek()).delivery;
    expect(after?.lines.find((line) => line.need === 'script')).toEqual({
      need: 'script',
      asked: 1,
      received: 1,
    });
    expect(after?.lines.find((line) => line.need === 'feed_shoot')).toEqual({
      need: 'feed_shoot',
      asked: 2,
      received: 1,
    });
    // Each boudoir session brings back the photo or video of its Mass DM.
    expect(after?.lines.find((line) => line.need === 'mass_dm')).toEqual({
      need: 'mass_dm',
      asked: 2,
      received: 0,
    });
    expect(after?.lines.find((line) => line.need === 'reveal_story')?.received).toBe(0);
    expect(after?.delivered).toBe(false);
  });
});
