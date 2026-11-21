import { randomUUID } from 'node:crypto';

import {
  ABSENCE_IN_PAST_UNPROCESSABLE,
  CreatorAbsenceSchema,
  CreatorIdSchema,
  CreatorLimitsSchema,
  newId,
  type CreatorId,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { addDays, calendarDayIn } from '../modules/scheduling/pure';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const PARIS = 'Europe/Paris';

/**
 * Her absences and what she no longer does (Charles, 21/11): told by her, taken back by her, read by her team on her
 * creator only, never by another creator, never by a member without her. Invented data only (ADR 0010).
 */
describe('what she tells the agency: her absences and what she no longer does', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: CreatorId;
  let ines: CreatorId;
  const cookies: Record<'nora' | 'ines' | 'owner' | 'chatter' | 'stranger', string> = {
    nora: '',
    ines: '',
    owner: '',
    chatter: '',
    stranger: '',
  };
  const today = calendarDayIn(new Date(), PARIS);

  const call = (method: 'GET' | 'POST', url: string, who: keyof typeof cookies, body?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie: cookies[who], origin: DASHBOARD_ORIGIN },
      ...(body === undefined ? {} : { payload: body }),
    });

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
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.owner = await signIn(server, 'owner@example.test', PASSWORD);
    cookies.chatter = await account('chatter@example.test', { role: 'operator', creatorIds: [nora] });
    cookies.stranger = await account('stranger@example.test', { role: 'operator', creatorIds: [ines] });
    cookies.nora = await account('nora@example.test', { role: 'creator', creatorIds: [nora] });
    cookies.ines = await account('ines@example.test', { role: 'creator', creatorIds: [ines] });
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('keeps her absence once, even sent twice, and her team on shift reads it', async () => {
    const body = { id: randomUUID(), startsOn: addDays(today, 3), endsOn: addDays(today, 5), note: 'Voyage' };
    const first = await call('POST', '/v1/creator-space/absences', 'nora', body);
    expect(first.statusCode).toBe(201);
    const again = await call('POST', '/v1/creator-space/absences', 'nora', body);
    expect(CreatorAbsenceSchema.parse(again.json())).toEqual(CreatorAbsenceSchema.parse(first.json()));

    const team = CreatorLimitsSchema.parse(
      (await call('GET', `/v1/creators/${nora}/limits`, 'chatter')).json(),
    );
    expect(team.absences.map((a) => a.note)).toEqual(['Voyage']);
    expect((await call('GET', `/v1/creators/${nora}/limits`, 'owner')).statusCode).toBe(200);
  });

  it('refuses an absence begun before today', async () => {
    const response = await call('POST', '/v1/creator-space/absences', 'nora', {
      id: randomUUID(),
      startsOn: addDays(today, -1),
      endsOn: addDays(today, 1),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ code: ABSENCE_IN_PAST_UNPROCESSABLE });
  });

  it('lets her take back what she no longer does, kept but never listed', async () => {
    const id = randomUUID();
    expect(
      (await call('POST', '/v1/creator-space/stops', 'nora', { id, what: 'Plus de vidéos en public' }))
        .statusCode,
    ).toBe(201);
    let mine = CreatorLimitsSchema.parse((await call('GET', '/v1/creator-space/limits', 'nora')).json());
    expect(mine.stops.map((s) => s.what)).toContain('Plus de vidéos en public');
    expect((await call('POST', `/v1/creator-space/stops/${id}/withdraw`, 'nora')).statusCode).toBe(204);
    mine = CreatorLimitsSchema.parse((await call('GET', '/v1/creator-space/limits', 'nora')).json());
    expect(mine.stops.map((s) => s.id)).not.toContain(id);
    const [row] = await test.admin.db
      .select()
      .from(schema.creatorStops)
      .where(eq(schema.creatorStops.id, id));
    expect(row?.withdrawnAt).not.toBeNull();
  });

  it('never shows her limits to another creator or to a member without her', async () => {
    await call('POST', '/v1/creator-space/stops', 'nora', {
      id: randomUUID(),
      what: 'Plus de lingerie rouge',
    });
    const ines_ = CreatorLimitsSchema.parse((await call('GET', '/v1/creator-space/limits', 'ines')).json());
    expect(ines_.stops).toEqual([]);
    expect(ines_.absences).toEqual([]);
    expect((await call('GET', `/v1/creators/${nora}/limits`, 'stranger')).statusCode).toBe(403);
    expect((await call('GET', `/v1/creators/${nora}/limits`, 'nora')).statusCode).toBe(403);
  });

  it('never lets her take back another creator’s line', async () => {
    const id = randomUUID();
    await call('POST', '/v1/creator-space/stops', 'nora', { id, what: 'Plus de tenues de sport' });
    expect((await call('POST', `/v1/creator-space/stops/${id}/withdraw`, 'ines')).statusCode).toBe(204);
    const mine = CreatorLimitsSchema.parse((await call('GET', '/v1/creator-space/limits', 'nora')).json());
    expect(mine.stops.map((s) => s.id)).toContain(id);
  });
});
