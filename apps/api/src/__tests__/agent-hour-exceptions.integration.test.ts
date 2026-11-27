import { AgentHourExceptionsViewSchema, ApiErrorSchema, localDate, reopenJobKey } from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** A date of her clock `days` from today: the tests never depend on the day they run. */
const dateIn = (days: number, timeZone: string) => localDate(new Date(Date.now() + days * DAY_MS), timeZone);

describe('her dated exceptions (ADR 0148 § 3, /v1/creators/:id/agent-hours/exceptions)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: Record<string, string>;
  let operator: Record<string, string>;
  let lea: { id: string };
  let nora: { id: string };

  const url = (creatorId: string, date?: string) =>
    `/v1/creators/${creatorId}/agent-hours/exceptions${date === undefined ? '' : `/${date}`}`;
  const list = async (creatorId: string) => {
    const response = await server.inject({ method: 'GET', url: url(creatorId), headers: owner });
    expect(response.statusCode).toBe(200);
    return AgentHourExceptionsViewSchema.parse(response.json());
  };
  const put = (creatorId: string, date: string, ranges: unknown, headers = owner) =>
    server.inject({ method: 'PUT', url: url(creatorId, date), headers, payload: { ranges } });
  const remove = (creatorId: string, date: string, headers = owner) =>
    server.inject({ method: 'DELETE', url: url(creatorId, date), headers });

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
    await createOwner(app.auth, app.db.db, OWNER);
    lea = await app.modules.persona.creators.create({ displayName: 'Léa' });
    nora = await app.modules.persona.creators.create({ displayName: 'Nora', timezone: 'America/New_York' });
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [lea.id] })
      .where(eq(schema.user.id, userId));
    owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    operator = { cookie: await signIn(server, OPERATOR.email, OPERATOR.password), origin: DASHBOARD_ORIGIN };
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('starts empty, on her clock', async () => {
    // The server reads the system clock: her day read before and after the request brackets the one it answers, so a
    // midnight in New York between the two never fails the test.
    const before = dateIn(0, 'America/New_York');
    const view = await list(nora.id);
    const after = dateIn(0, 'America/New_York');
    expect(view).toEqual({ exceptions: [], timeZone: 'America/New_York', today: view.today });
    expect([before, after]).toContain(view.today);
  });

  it('lets the owner write a date, replace it, give it back to her week, each change audited', async () => {
    const tomorrow = dateIn(1, 'Europe/Paris');
    const written = await put(lea.id, tomorrow, [{ startMinute: 1320, endMinute: 1440 }]);
    expect(written.statusCode).toBe(200);
    expect(AgentHourExceptionsViewSchema.parse(written.json()).exceptions).toMatchObject([
      { date: tomorrow, ranges: [{ startMinute: 1320, endMinute: 1440 }] },
    ]);
    // The same date again replaces it; no range at all means no agent that day.
    expect((await put(lea.id, tomorrow, [])).statusCode).toBe(200);
    expect((await list(lea.id)).exceptions).toMatchObject([{ date: tomorrow, ranges: [] }]);
    // Her opening is computed again with the date (ADR 0148 § 3): the fans put off wait for it.
    const reopen = await test.admin.db.execute(
      sql`select 1 from graphile_worker._private_jobs where key = ${reopenJobKey(lea.id)}`,
    );
    expect(reopen.rows).toHaveLength(1);
    expect((await remove(lea.id, tomorrow)).statusCode).toBe(200);
    expect((await list(lea.id)).exceptions).toEqual([]);
    const audit = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'creator.agent_hour_exception'));
    expect(audit).toHaveLength(3);
  });

  it('refuses a date already past, and ranges that overlap, writing nothing', async () => {
    const yesterday = dateIn(-1, 'Europe/Paris');
    const past = await put(lea.id, yesterday, []);
    expect(past.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(past.json()).error.code).toBe('agent_hour_exception_conflict');
    expect((await remove(lea.id, yesterday)).statusCode).toBe(409);
    const overlap = await put(lea.id, dateIn(2, 'Europe/Paris'), [
      { startMinute: 600, endMinute: 900 },
      { startMinute: 800, endMinute: 1000 },
    ]);
    expect(overlap.statusCode).toBe(400);
    expect((await list(lea.id)).exceptions).toEqual([]);
  });

  it('keeps every creator’s dates apart', async () => {
    const date = dateIn(3, 'Europe/Paris');
    expect((await put(lea.id, date, [{ startMinute: 0, endMinute: 240 }])).statusCode).toBe(200);
    expect((await list(nora.id)).exceptions).toEqual([]);
    expect((await list(lea.id)).exceptions).toHaveLength(1);
  });

  it('is the owner’s alone, like her hours', async () => {
    const date = dateIn(4, 'Europe/Paris');
    expect((await server.inject({ method: 'GET', url: url(lea.id), headers: operator })).statusCode).toBe(
      403,
    );
    expect((await put(lea.id, date, [], operator)).statusCode).toBe(403);
    expect((await remove(lea.id, date, operator)).statusCode).toBe(403);
    const missing = '0199f2a0-0000-7000-8000-0000000000ff';
    const unknown = await put(missing, date, []);
    expect([unknown.statusCode, ApiErrorSchema.parse(unknown.json()).error.code]).toEqual([
      404,
      'creator_not_found',
    ]);
  });
});
