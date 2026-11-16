import {
  ConnectorWriteGuardSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * An account's write guard from the CRM (16/11): the owner opens its sends, all of them or only to the conversations
 * named (the first real sale goes to the test fan alone). Read and changed under the account's creator; each change
 * in the audit log with how many conversations it names, never which. Invented data only (ADR 0010).
 */
describe('write guard of a platform account', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerCookie: string;
  let operatorCookie: string;
  const creatorId = newId(CreatorIdSchema);
  const accountId = newId(PlatformAccountIdSchema);
  const url = (id: string) => `/v1/connector/accounts/${id}/write-guard`;

  const call = (method: 'GET' | 'PUT', path: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url: path,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });

  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;

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
    await test.admin.db.insert(schema.creators).values({
      id: creatorId,
      nameKey: creatorId,
      displayName: 'nora',
      timezone: 'Europe/Paris',
    });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: accountId,
      creatorId,
      platform: 'reveal',
      handle: 'nora-reveal',
      connectorConfig: { pollIntervalSeconds: 90 },
    });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    ownerCookie = await signIn(server, 'owner@example.test', PASSWORD);
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: 'operator@example.test',
      name: 'Operator',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, userId));
    operatorCookie = await signIn(server, 'operator@example.test', PASSWORD);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('reads it closed by default, and lets the owner open it to one conversation, the rest of the rhythm kept', async () => {
    const before = await call('GET', url(accountId), ownerCookie);
    expect(before.statusCode).toBe(200);
    expect(ConnectorWriteGuardSchema.parse(before.json())).toEqual({ writes: false, writesOnlyTo: null });

    const set = await call('PUT', url(accountId), ownerCookie, {
      writes: true,
      writesOnlyTo: ['conv_test', 'conv_test'],
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toEqual({ writes: true, writesOnlyTo: ['conv_test'] });

    const [row] = await test.admin.db
      .select({ config: schema.platformAccounts.connectorConfig })
      .from(schema.platformAccounts)
      .where(eq(schema.platformAccounts.id, accountId));
    expect(row?.config).toMatchObject({ pollIntervalSeconds: 90, writes: true, writesOnlyTo: ['conv_test'] });

    const audit = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, accountId));
    expect(audit).toEqual([
      { action: 'connector.write_guard', details: { creatorId, writes: true, only: 1 } },
    ]);
    expect(JSON.stringify(audit)).not.toContain('conv_test');
  });

  it('is the owner’s alone, and answers 404 for an account that does not exist', async () => {
    const read = await call('GET', url(accountId), operatorCookie);
    expect(read.statusCode).toBe(403);
    const write = await call('PUT', url(accountId), operatorCookie, { writes: true, writesOnlyTo: null });
    expect(write.statusCode).toBe(403);
    const missing = await call('PUT', url(newId(PlatformAccountIdSchema)), ownerCookie, {
      writes: true,
      writesOnlyTo: null,
    });
    expect(missing.statusCode).toBe(404);
    expect(codeOf(missing)).toBe('platform_account_not_found');
    const bad = await call('PUT', url(accountId), ownerCookie, { writes: true, writesOnlyTo: [''] });
    expect(bad.statusCode).toBe(400);
  });
});
