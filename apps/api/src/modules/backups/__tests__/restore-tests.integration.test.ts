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
const SUCCEEDED_SHA = 'c'.repeat(64);
const FAILED_SHA = 'd'.repeat(64);

/** The quarterly restore test entered by the owner (ADR 0028 § 6, EQ-17), through the real app and tables. */
describe('/v1/backups/restore-tests', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  const finishedAt = new Date(Date.now() - 5 * 86_400_000);

  const post = (payload: object, cookie = owner) =>
    server.inject({
      method: 'POST',
      url: '/v1/backups/restore-tests',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  const body = (overrides: object = {}) => ({
    id: randomUUID(),
    backupSha256: SUCCEEDED_SHA.toUpperCase(),
    testedAt: new Date(Date.now() - 86_400_000).toISOString(),
    durationSeconds: 1_260,
    rowCountMismatches: 0,
    notes: '  Restauré sur le PC, 33 tables identiques  ',
    ...overrides,
  });
  const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;

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
    await test.admin.db.insert(schema.backupRuns).values([
      {
        startedAt: new Date(finishedAt.getTime() - 60_000),
        finishedAt,
        status: 'succeeded',
        objectKey: 'backups/nirvana-test.tar.age',
        sizeBytes: 4096,
        sha256: SUCCEEDED_SHA,
        pgDumpVersion: '16.15',
        rowCounts: { creators: 1 },
      },
      // A failed run never has a fingerprint in production; this one checks the lookup reads `succeeded` only.
      {
        startedAt: new Date(finishedAt.getTime() - 3_600_000),
        finishedAt: new Date(finishedAt.getTime() - 3_590_000),
        status: 'failed',
        sha256: FAILED_SHA,
        error: 'failed at step upload',
      },
    ]);
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('is closed to an operator, and asks the owner for a recent sign-in', async () => {
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    expect((await post(body(), operator)).statusCode).toBe(403);
    await test.admin.db.update(schema.session).set({ createdAt: sql`now() - interval '1 hour'` });
    const stale = await post(body());
    expect(stale.statusCode).toBe(403);
    expect(codeOf(stale)).toBe('reauthentication_forbidden');
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  it('records the test once, with its audit line without the notes, and gives it back on a replay', async () => {
    const entry = body();
    const created = await post(entry);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      id: entry.id,
      backupSha256: SUCCEEDED_SHA,
      notes: 'Restauré sur le PC, 33 tables identiques',
      rowCountMismatches: 0,
    });
    const replay = await post(entry);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(created.json());

    const rows = await test.admin.db
      .select()
      .from(schema.restoreTests)
      .where(eq(schema.restoreTests.id, entry.id));
    expect(rows).toHaveLength(1);
    const audit = await test.admin.db
      .select({ details: schema.auditLog.details, ip: schema.auditLog.ip })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'restore_test.record'), eq(schema.auditLog.entityId, entry.id)));
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]?.details)).not.toContain('Restauré');
    expect(audit[0]?.details).toMatchObject({ rowCountMismatches: 0 });

    const conflict = await post({ ...entry, rowCountMismatches: 4 });
    expect(conflict.statusCode).toBe(409);
    expect(codeOf(conflict)).toBe('restore_test_conflict');
  });

  it('refuses an unknown or failed export, a test before its export, one in the future, and out-of-range numbers', async () => {
    const unknown = await post(body({ backupSha256: 'e'.repeat(64) }));
    expect([unknown.statusCode, codeOf(unknown)]).toEqual([422, 'restore_test_backup_unprocessable']);
    const failed = await post(body({ backupSha256: FAILED_SHA }));
    expect([failed.statusCode, codeOf(failed)]).toEqual([422, 'restore_test_backup_unprocessable']);
    const before = await post(body({ testedAt: new Date(finishedAt.getTime() - 1_000).toISOString() }));
    expect([before.statusCode, codeOf(before)]).toEqual([422, 'restore_test_before_backup_unprocessable']);
    const future = await post(body({ testedAt: new Date(Date.now() + 3_600_000).toISOString() }));
    expect([future.statusCode, codeOf(future)]).toEqual([422, 'restore_test_in_future_unprocessable']);
    expect((await post(body({ durationSeconds: 86_401 }))).statusCode).toBe(400);
    expect((await post(body({ rowCountMismatches: 1_000_001 }))).statusCode).toBe(400);
    expect((await post(body({ durationSeconds: 1.5 }))).statusCode).toBe(400);
  });

  it('shows the latest test in the status, and freshness follows it', async () => {
    await post(body({ testedAt: new Date(Date.now() - 3_600_000).toISOString(), rowCountMismatches: 2 }));
    const status = await server.inject({
      method: 'GET',
      url: '/v1/backups/status',
      headers: { cookie: owner },
    });
    expect(status.json()).toMatchObject({
      lastRestoreTest: { rowCountMismatches: 2, backupFinishedAt: finishedAt.toISOString() },
      restoreTestFresh: false,
    });
    expect(await app.modules.backups.restoreTestFresh(new Date())).toBe(false);
    await post(body({ testedAt: new Date(Date.now() - 60_000).toISOString() }));
    expect(await app.modules.backups.restoreTestFresh(new Date())).toBe(true);
  });

  it('keeps restore_tests append-only for the application role', async () => {
    await expect(app.db.db.execute(sql`update restore_tests set notes = 'changed'`)).rejects.toThrow();
    await expect(app.db.db.execute(sql`delete from restore_tests`)).rejects.toThrow();
  });
});
