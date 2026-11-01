import { randomUUID } from 'node:crypto';

import { and, eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { testConfig } from '../../../__tests__/support/config';
import { DASHBOARD_ORIGIN, signIn } from '../../../__tests__/support/sign-in';
import { createOwner } from '../../../auth';
import { createApp, type App } from '../../../composition-root';
import { createLogger } from '../../../logger';
import { buildServer, type Server } from '../../../server';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

/** « Relancer la sauvegarde maintenant » (REG-24): the API records the request, the `backup` service runs it. */
describe('/v1/backups/runs', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;

  const post = (id: string, cookie = owner) =>
    server.inject({
      method: 'POST',
      url: '/v1/backups/runs',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload: { id },
    });
  const status = async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/backups/status',
      headers: { cookie: owner },
    });
    return z.object({ runRequestedAt: z.string().optional() }).parse(response.json());
  };
  const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;
  /** What the `backup` service does every 30 seconds (ops/db-export/schedule.sh), with its admin role. */
  const pickUp = () =>
    test.admin.db.execute(sql`update backup_requests set picked_at = now() where picked_at is null`);

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
    await createOwner(app.auth, app.db.db, OWNER);
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('is closed to an operator, and asks the owner for a recent sign-in', async () => {
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    expect((await post(randomUUID(), operator)).statusCode).toBe(403);
    await test.admin.db.update(schema.session).set({ createdAt: sql`now() - interval '1 hour'` });
    const stale = await post(randomUUID());
    expect([stale.statusCode, codeOf(stale)]).toEqual([403, 'reauthentication_forbidden']);
    owner = await signIn(server, OWNER.email, OWNER.password);
    expect(await test.admin.db.select().from(schema.backupRequests)).toHaveLength(0);
  });

  it('records one request with its audit line, gives it back to a replay and to a second press', async () => {
    const id = randomUUID();
    const created = await post(id);
    expect(created.statusCode).toBe(202);
    expect(created.json()).toMatchObject({ id, pickedAt: null });
    expect(await status()).toEqual({ runRequestedAt: created.json<{ requestedAt: string }>().requestedAt });

    const replay = await post(id);
    expect([replay.statusCode, replay.json()]).toEqual([200, created.json()]);
    const second = await post(randomUUID());
    expect([second.statusCode, second.json()]).toEqual([200, created.json()]);
    expect(await test.admin.db.select().from(schema.backupRequests)).toHaveLength(1);
    const audit = await test.admin.db
      .select()
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'backup.request'), eq(schema.auditLog.entityId, id)));
    expect(audit).toHaveLength(1);
  });

  it('leaves the status once picked up, and refuses a new one while the export runs', async () => {
    await pickUp();
    expect(await status()).toEqual({});
    await test.admin.db
      .insert(schema.backupRuns)
      .values({ startedAt: new Date(Date.now() - 30_000), status: 'running' });
    const running = await post(randomUUID());
    expect([running.statusCode, codeOf(running)]).toEqual([409, 'backup_run_in_progress_conflict']);

    await test.admin.db
      .update(schema.backupRuns)
      .set({ status: 'failed', finishedAt: new Date(), error: 'failed at step upload' });
    expect((await post(randomUUID())).statusCode).toBe(202);
  });

  it('gives the application role no way to mark a request picked nor to delete one', async () => {
    const denied = { cause: { code: '42501' } };
    await expect(app.db.db.execute(sql`update backup_requests set picked_at = now()`)).rejects.toMatchObject(
      denied,
    );
    await expect(app.db.db.execute(sql`delete from backup_requests`)).rejects.toMatchObject(denied);
  });
});
