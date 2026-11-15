import { randomBytes } from 'node:crypto';

import { CreatorIdSchema, CreatorTaskIdSchema, newId, type CreatorId } from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { addDays, calendarDayIn, isoWeekday, wallClockToInstant } from '../modules/scheduling/pure';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

const JobSchema = z.object({
  key: z.string(),
  run_at: z.coerce.date(),
  payload: z.object({ taskId: z.string(), startsAt: z.string() }),
});

/**
 * Her reminders (CR-05 lot b3): the job that a task with a reminder enqueues with its write, moved with it, and what it
 * rings on her accounts, once. Push is on (CREDENTIALS_ENCRYPTION_KEYS); no device is subscribed, so nothing leaves
 * the server and each decision is still kept. Invented data only (ADR 0010).
 */
describe('creator_tasks.remind', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let cookie = '';
  const today = calendarDayIn(new Date(), PARIS);
  // Next week's Wednesday: always ahead, whatever today is.
  const nextWednesday = addDays(today, 7 - isoWeekday(today) + 3);
  const at = (day: string, hour: number) => wallClockToInstant(day, hour * 60, PARIS).toISOString();

  const call = (method: 'POST' | 'PATCH' | 'DELETE', url: string, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

  /** The reminder job waiting for a task, if any. */
  async function jobOf(taskId: string) {
    const result = await test.admin.db.execute(sql`
      select j.key, j.run_at, j.payload
        from graphile_worker._private_jobs j
        join graphile_worker._private_tasks t on t.id = j.task_id
       where t.identifier = 'creator_tasks.remind' and j.key = ${`creator_tasks.remind:${taskId}`}`);
    return z.array(JobSchema).parse(result.rows);
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_SERVICE_URL: test.serviceUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${randomBytes(32).toString('base64')}`,
    });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    nora = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: nora, nameKey: nora, displayName: 'Nora', timezone: PARIS });
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: 'nora@example.test',
      name: 'Nora',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'creator', creatorIds: [nora] })
      .where(eq(schema.user.id, userId));
    cookie = await signIn(server, 'nora@example.test', PASSWORD);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('schedules her reminder with the task, moves it with the task, and rings it once', async () => {
    const id = newId(CreatorTaskIdSchema);
    const created = await call('POST', '/v1/creator-space/tasks', {
      id,
      when: { kind: 'timed', startsAt: at(nextWednesday, 15), endsAt: at(nextWednesday, 16) },
      category: 'shoot',
      title: 'Tournage robe rouge',
      reminderMinutes: 15,
    });
    expect(created.statusCode, created.body).toBe(200);
    const [first] = await jobOf(id);
    expect(first?.run_at.toISOString()).toBe(
      wallClockToInstant(nextWednesday, 14 * 60 + 45, PARIS).toISOString(),
    );

    // Moved to 17 h: the same job, at the new time.
    const moved = await call('PATCH', `/v1/creator-space/tasks/${id}`, {
      when: { kind: 'timed', startsAt: at(nextWednesday, 17), endsAt: at(nextWednesday, 18) },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    const jobs = await jobOf(id);
    expect(jobs).toHaveLength(1);
    const [job] = jobs;
    if (job === undefined) throw new Error('no reminder job');
    expect(job.payload.startsAt).toBe(at(nextWednesday, 17));
    expect(job.run_at.toISOString()).toBe(
      wallClockToInstant(nextWednesday, 16 * 60 + 45, PARIS).toISOString(),
    );

    const remind = app.modules.creatorTasks.remind;
    if (remind === null) throw new Error('push is off');
    // The job of before the move, had it run: nothing rings.
    expect(
      await remind({ taskId: id, startsAt: at(nextWednesday, 15) }, new Date(at(nextWednesday, 14))),
    ).toEqual([]);
    expect(await remind(job.payload, job.run_at)).toEqual(['rang']);
    expect(await remind(job.payload, job.run_at)).toEqual(['duplicate']);
  });

  it('rings nothing for a task removed, and schedules nothing without a reminder', async () => {
    const id = newId(CreatorTaskIdSchema);
    await call('POST', '/v1/creator-space/tasks', {
      id,
      when: { kind: 'timed', startsAt: at(nextWednesday, 10), endsAt: at(nextWednesday, 11) },
      category: 'post',
      title: 'Publier le carrousel',
      reminderMinutes: 30,
    });
    const [job] = await jobOf(id);
    if (job === undefined) throw new Error('no reminder job');
    expect((await call('DELETE', `/v1/creator-space/tasks/${id}`)).statusCode).toBe(204);
    expect(await app.modules.creatorTasks.remind?.(job.payload, job.run_at)).toEqual([]);

    const quiet = newId(CreatorTaskIdSchema);
    await call('POST', '/v1/creator-space/tasks', {
      id: quiet,
      when: { kind: 'timed', startsAt: at(nextWednesday, 12), endsAt: at(nextWednesday, 13) },
      category: 'socials',
      title: 'Répondre aux commentaires',
    });
    expect(await jobOf(quiet)).toEqual([]);
  });
});
