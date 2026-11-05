import {
  AgencySuggestionListSchema,
  AgencySuggestionSchema,
  AvailabilityIdSchema,
  CreatorAgendaSchema,
  CreatorIdSchema,
  CreatorStreakResultSchema,
  CreatorTaskIdSchema,
  CreatorTaskSchema,
  CreatorTicksResultSchema,
  newId,
  SuggestionIdSchema,
  TeamMemberIdSchema,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
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
 * Her agenda (CR-05, ADR 0042 § 3 and § 4): her tasks, ticks and dispos through her own door, the agency's suggestions
 * that fall only inside a dispo, her decision once. Days are read from today in Paris, so the test holds any day.
 * Invented data only (ADR 0010).
 */
describe('/v1/creator-space/agenda and the agency’s suggestions', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies: Record<'nora' | 'ines' | 'owner' | 'manager' | 'chatter', string> = {
    nora: '',
    ines: '',
    owner: '',
    manager: '',
    chatter: '',
  };
  const today = calendarDayIn(new Date(), PARIS);
  // Next week's Wednesday: always ahead, whatever today is.
  const nextWednesday = addDays(today, 7 - isoWeekday(today) + 3);
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

  async function account(email: string, set: Partial<typeof schema.user.$inferInsert>) {
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: email, password: PASSWORD });
    await test.admin.db.update(schema.user).set(set).where(eq(schema.user.id, userId));
    return { userId, cookie: await signIn(server, email, PASSWORD) };
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
    nora = newId(CreatorIdSchema);
    ines = newId(CreatorIdSchema);
    for (const [id, label] of [
      [nora, 'Nora'],
      [ines, 'Ines'],
    ] as const)
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: PARIS });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    for (const teamRole of ['manager', 'chatter'] as const) {
      const member = await account(`${teamRole}@example.test`, { role: 'operator' });
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
    }
    cookies.nora = (await account('nora@example.test', { role: 'creator', creatorIds: [nora] })).cookie;
    cookies.ines = (await account('ines@example.test', { role: 'creator', creatorIds: [ines] })).cookie;
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const agenda = async (who: 'nora' | 'ines' = 'nora') => {
    const response = await call(
      'GET',
      `/v1/creator-space/agenda?from=${today}&to=${addDays(nextWednesday, 4)}`,
      who,
    );
    expect(response.statusCode, response.body).toBe(200);
    return CreatorAgendaSchema.parse(response.json());
  };

  it('opens her agenda to her alone', async () => {
    expect((await agenda()).timeZone).toBe(PARIS);
    for (const who of ['owner', 'manager', 'chatter'] as const)
      expect((await call('GET', `/v1/creator-space/agenda?from=${today}&to=${today}`, who)).statusCode).toBe(
        403,
      );
    expect(
      (await call('GET', `/v1/creator-space/agenda?from=${today}&to=${addDays(today, 60)}`, 'nora'))
        .statusCode,
    ).toBe(400);
  });

  it('adds her task once, whatever her phone replays, and refuses another content under its id', async () => {
    const task = {
      id: newId(CreatorTaskIdSchema),
      when: { kind: 'timed', startsAt: at(nextWednesday, 15), endsAt: at(nextWednesday, 16) },
      category: 'shoot',
      title: 'Tournage robe rouge',
    };
    const first = await call('POST', '/v1/creator-space/tasks', 'nora', task);
    expect(first.statusCode, first.body).toBe(200);
    expect((await call('POST', '/v1/creator-space/tasks', 'nora', task)).json()).toEqual(first.json());
    expect(
      (await call('POST', '/v1/creator-space/tasks', 'nora', { ...task, title: 'Autre' })).statusCode,
    ).toBe(409);
    expect((await agenda()).tasks.map((one) => one.title)).toContain('Tournage robe rouge');
    // CREA-14: never 1900 nor 9999.
    for (const day of ['1900-01-01', '9999-12-31']) {
      const far = { ...task, id: newId(CreatorTaskIdSchema), when: { kind: 'day', day } };
      expect((await call('POST', '/v1/creator-space/tasks', 'nora', far)).statusCode).toBe(400);
    }
    expect((await agenda('ines')).tasks).toEqual([]);
    // Ines cannot move it: for her it does not exist.
    expect(
      (await call('PATCH', `/v1/creator-space/tasks/${task.id}`, 'ines', { title: 'Volé' })).statusCode,
    ).toBe(404);
  });

  it('ticks her own routine once a day, refuses a day it is not due, and takes a tick back', async () => {
    const id = newId(CreatorTaskIdSchema);
    const routine = {
      id,
      when: { kind: 'routine', weekdays: [isoWeekday(today)] },
      category: 'post',
      title: 'Story',
    };
    expect((await call('POST', '/v1/creator-space/tasks', 'nora', routine)).statusCode).toBe(200);
    const tick = { taskId: id, day: today, doneAt: new Date().toISOString() };
    const first = CreatorTicksResultSchema.parse(
      (await call('POST', '/v1/creator-space/ticks', 'nora', { ticks: [tick, tick] })).json(),
    );
    expect(first.added).toBe(1);
    const replay = CreatorTicksResultSchema.parse(
      (await call('POST', '/v1/creator-space/ticks', 'nora', { ticks: [tick] })).json(),
    );
    expect(replay.added).toBe(0);
    // Her own routine is not essential: it never makes a streak on its own.
    expect(replay.streak.days).toBe(0);
    const offDay = await call('POST', '/v1/creator-space/ticks', 'nora', {
      ticks: [{ ...tick, day: addDays(today, 1) }],
    });
    expect(offDay.statusCode).toBe(422);
    // ADR 0042 § 8: never a tick older than 48 h, nor a routine tick for a day she did not tick it on.
    const stale = await call('POST', '/v1/creator-space/ticks', 'nora', {
      ticks: [{ ...tick, doneAt: new Date(Date.now() - 49 * 3_600_000).toISOString() }],
    });
    expect(stale.json()).toMatchObject({ error: { code: 'creator_tick_late_unprocessable' } });
    // A routine of every day, ticked now for tomorrow: due that day, but not the day she ticked it.
    const daily = {
      ...routine,
      id: newId(CreatorTaskIdSchema),
      when: { kind: 'routine', weekdays: [1, 2, 3, 4, 5, 6, 7] },
    };
    expect((await call('POST', '/v1/creator-space/tasks', 'nora', daily)).statusCode).toBe(200);
    // CREA-08: her agenda says when it entered it, from which day her phone counts it due.
    const created = (await agenda()).tasks.find((one) => one.id === daily.id)?.createdAt;
    expect(Math.abs(Date.now() - Date.parse(created ?? ''))).toBeLessThan(60_000);
    const ahead = await call('POST', '/v1/creator-space/ticks', 'nora', {
      ticks: [{ ...tick, taskId: daily.id, day: addDays(today, 1) }],
    });
    expect(ahead.json()).toMatchObject({ error: { code: 'creator_tick_late_unprocessable' } });
    const back = await call('DELETE', `/v1/creator-space/tasks/${id}/ticks/${today}`, 'nora');
    expect(back.statusCode, back.body).toBe(200);
    CreatorStreakResultSchema.parse(back.json());
    expect((await agenda()).ticks.filter((one) => one.taskId === id)).toEqual([]);
  });

  it('places the agency’s suggestion only inside her dispo, over none of her tasks; a chatter does not suggest', async () => {
    const dispo = {
      id: newId(AvailabilityIdSchema),
      when: { kind: 'weekly', weekday: 3, startMinute: 14 * 60, endMinute: 20 * 60 },
    };
    expect((await call('POST', '/v1/creator-space/availabilities', 'nora', dispo)).statusCode).toBe(200);
    const suggest = (who: 'owner' | 'manager' | 'chatter', from: number, to: number, title: string) =>
      call('POST', `/v1/creators/${nora}/suggestions`, who, {
        id: newId(SuggestionIdSchema),
        when: { kind: 'timed', startsAt: at(nextWednesday, from), endsAt: at(nextWednesday, to) },
        category: 'live',
        title,
      });
    const inside = AgencySuggestionSchema.parse(
      (await suggest('manager', 17, 18, 'Live du mercredi')).json(),
    );
    expect(inside.when).not.toBeNull();
    // Outside her dispo, and over her shoot of 15 h: both undated, their length kept.
    const outside = AgencySuggestionSchema.parse((await suggest('owner', 10, 11, 'Live du matin')).json());
    expect(outside).toMatchObject({ when: null, minutes: 60 });
    expect(
      AgencySuggestionSchema.parse((await suggest('owner', 15, 16, 'Live sur le tournage')).json()).when,
    ).toBeNull();
    expect((await suggest('chatter', 18, 19, 'Live du chatteur')).statusCode).toBe(403);
    // She reads them without where they came from.
    const seen = (await agenda()).suggestions;
    expect(seen.map((one) => one.title).sort()).toEqual([
      'Live du matin',
      'Live du mercredi',
      'Live sur le tournage',
    ]);
    expect(JSON.stringify(seen)).not.toMatch(/origin|agency|manager/u);
  });

  it('lets her accept or decline once, and keeps a declined task away the week after', async () => {
    const seen = (await agenda()).suggestions;
    const placed = seen.find((one) => one.title === 'Live du mercredi');
    const undated = seen.find((one) => one.title === 'Live du matin');
    const other = seen.find((one) => one.title === 'Live sur le tournage');
    if (placed === undefined || undated === undefined || other === undefined)
      throw new Error('suggestions missing');
    const accepted = await call('POST', `/v1/creator-space/suggestions/${placed.id}/accept`, 'nora', {});
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(CreatorTaskSchema.parse(accepted.json()).title).toBe('Live du mercredi');
    // A second tap answers the same task.
    expect(
      (await call('POST', `/v1/creator-space/suggestions/${placed.id}/accept`, 'nora', {})).json(),
    ).toEqual(accepted.json());
    expect(
      (await call('POST', `/v1/creator-space/suggestions/${undated.id}/accept`, 'nora', {})).statusCode,
    ).toBe(422);
    const moved = { kind: 'timed', startsAt: at(nextWednesday, 19), endsAt: at(nextWednesday, 20) };
    expect(
      (await call('POST', `/v1/creator-space/suggestions/${undated.id}/accept`, 'nora', { when: moved }))
        .statusCode,
    ).toBe(200);
    // Ines does not see Nora's suggestions.
    expect(
      (await call('POST', `/v1/creator-space/suggestions/${other.id}/decline`, 'ines', {})).statusCode,
    ).toBe(404);
    const declined = await call('POST', `/v1/creator-space/suggestions/${other.id}/decline`, 'nora', {
      reason: 'Pas en live',
    });
    expect(declined.statusCode).toBe(204);
    expect(
      (await call('POST', `/v1/creator-space/suggestions/${other.id}/decline`, 'nora', {})).statusCode,
    ).toBe(204);
    expect(
      (await call('POST', `/v1/creator-space/suggestions/${other.id}/accept`, 'nora', {})).statusCode,
    ).toBe(409);
    const again = await call('POST', `/v1/creators/${nora}/suggestions`, 'owner', {
      id: newId(SuggestionIdSchema),
      // Next week: she declined it this week.
      when: { kind: 'day', day: addDays(nextWednesday, 1) },
      category: 'live',
      title: 'live sur le  tournage',
    });
    expect(again.statusCode).toBe(409);
    const week = addDays(nextWednesday, -2);
    const listed = AgencySuggestionListSchema.parse(
      (await call('GET', `/v1/creators/${nora}/suggestions?week=${week}`, 'manager')).json(),
    );
    expect(listed.items.find((one) => one.title === 'Live sur le tournage')).toMatchObject({
      state: 'declined',
      reason: 'Pas en live',
      task: null,
    });
    // The agency reads the task as she keeps it: moved to 19 h, not done yet, still in her agenda.
    expect(listed.items.find((one) => one.title === 'Live du matin')).toMatchObject({
      state: 'accepted',
      task: { when: moved, doneDays: 0, removed: false },
    });
    expect((await call('GET', `/v1/creators/${nora}/suggestions?week=${week}`, 'chatter')).statusCode).toBe(
      403,
    );
  });

  it('keeps a suggestion’s kind when she moves it, and answers a used id with a conflict', async () => {
    const suggest = async (when: object, title: string) =>
      AgencySuggestionSchema.parse(
        (
          await call('POST', `/v1/creators/${nora}/suggestions`, 'owner', {
            id: newId(SuggestionIdSchema),
            when,
            category: 'post',
            title,
          })
        ).json(),
      );
    const dated = await suggest({ kind: 'day', day: nextWednesday }, 'Publication du mercredi');
    const routine = await suggest({ kind: 'routine', weekdays: [1, 3] }, 'Story du lundi');
    // A dated suggestion never becomes her routine, which would make it essential; her routine never becomes a day.
    const toRoutine = await call('POST', `/v1/creator-space/suggestions/${dated.id}/accept`, 'nora', {
      when: { kind: 'routine', weekdays: [1, 2, 3, 4, 5, 6, 7] },
    });
    expect(toRoutine.statusCode).toBe(422);
    const toDay = await call('POST', `/v1/creator-space/suggestions/${routine.id}/accept`, 'nora', {
      when: { kind: 'day', day: today },
    });
    expect(toDay.statusCode).toBe(422);
    // CREA-09: never into her past.
    const past = await call('POST', `/v1/creator-space/suggestions/${dated.id}/accept`, 'nora', {
      when: { kind: 'day', day: addDays(today, -1) },
    });
    expect(past.json()).toMatchObject({ error: { code: 'creator_suggestion_past_unprocessable' } });
    // Moved within its kind, it is accepted.
    const moved = await call('POST', `/v1/creator-space/suggestions/${dated.id}/accept`, 'nora', {
      when: { kind: 'day', day: addDays(nextWednesday, 1) },
    });
    expect(CreatorTaskSchema.parse(moved.json())).toMatchObject({ essential: false });
    // The id of Nora's suggestion, sent again for Ines: hidden from her RLS, refused as a conflict.
    const taken = await call('POST', `/v1/creators/${ines}/suggestions`, 'owner', {
      id: routine.id,
      when: { kind: 'day', day: nextWednesday },
      category: 'post',
      title: 'Autre chose',
    });
    expect(taken.statusCode, taken.body).toBe(409);
  });

  it('counts the agency’s routine she accepted for her streak, once ticked today', async () => {
    const created = AgencySuggestionSchema.parse(
      (
        await call('POST', `/v1/creators/${nora}/suggestions`, 'owner', {
          id: newId(SuggestionIdSchema),
          when: { kind: 'routine', weekdays: [1, 2, 3, 4, 5, 6, 7] },
          category: 'socials',
          title: 'Répondre aux commentaires',
        })
      ).json(),
    );
    const task = CreatorTaskSchema.parse(
      (await call('POST', `/v1/creator-space/suggestions/${created.id}/accept`, 'nora', {})).json(),
    );
    expect(task.essential).toBe(true);
    // She keeps it in her routine: she cannot turn it into a task of a day.
    expect(
      (
        await call('PATCH', `/v1/creator-space/tasks/${task.id}`, 'nora', {
          when: { kind: 'day', day: today },
        })
      ).statusCode,
    ).toBe(409);
    const ticked = CreatorTicksResultSchema.parse(
      (
        await call('POST', '/v1/creator-space/ticks', 'nora', {
          ticks: [{ taskId: task.id, day: today, doneAt: new Date().toISOString() }],
        })
      ).json(),
    );
    expect(ticked.streak).toMatchObject({ days: 1, atRisk: false });
    // The agency sees the day she did it, then that she removed it.
    const followUp = async () =>
      AgencySuggestionListSchema.parse(
        (await call('GET', `/v1/creators/${nora}/suggestions?week=${today}`, 'manager')).json(),
      ).items.find((one) => one.id === created.id)?.task;
    expect(await followUp()).toMatchObject({ doneDays: 1, removed: false });
    expect((await call('DELETE', `/v1/creator-space/tasks/${task.id}`, 'nora')).statusCode).toBe(204);
    expect(await followUp()).toMatchObject({ doneDays: 1, removed: true });
  });
});
