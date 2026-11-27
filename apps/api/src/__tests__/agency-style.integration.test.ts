import { ApiErrorSchema, type AgencyStyleOverview, type AgencyStyleVersion } from '@impera/contracts';
import { eq, schema } from '@impera/db';
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

// Invented texts only: the agency's real style lives in its base, never in the repo (ADR 0173).
const CONTENT = {
  privateStyle: 'Phrase de style inventée',
  publicStyle: 'Phrase de style publique inventée',
  form: { capitalization: 'capital', strip_final_period: true },
};

describe('the agency’s base style (GET, PUT /v1/agency/style, POST …/activate; ADR 0173)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;
  let operator: string;

  const get = (cookie: string) =>
    server.inject({ method: 'GET', url: '/v1/agency/style', headers: { cookie } });
  const put = (cookie: string, payload: object) =>
    server.inject({
      method: 'PUT',
      url: '/v1/agency/style',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  const activate = (cookie: string, versionId: string, expectedActive: string | null) =>
    server.inject({
      method: 'POST',
      url: `/v1/agency/style/versions/${versionId}/activate`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload: { expectedActive },
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
    await createOwner(app.auth, app.db.db, OWNER);
    const { userId } = await createOwner(app.auth, app.db.db, OPERATOR);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    operator = await signIn(server, OPERATOR.email, OPERATOR.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('is the owner’s alone, validated at the door, saved as versions never active, audited', async () => {
    expect((await server.inject({ method: 'GET', url: '/v1/agency/style' })).statusCode).toBe(401);
    expect((await get(operator)).statusCode).toBe(403);
    expect((await put(operator, CONTENT)).statusCode).toBe(403);
    expect((await get(owner)).json()).toEqual({ active: null, versions: [] });

    expect((await put(owner, { ...CONTENT, privateStyle: 'x'.repeat(8_001) })).statusCode).toBe(400);
    expect((await put(owner, { ...CONTENT, form: { capitalization: 'shout' } })).statusCode).toBe(400);
    expect((await put(owner, { ...CONTENT, extra: true })).statusCode).toBe(400);

    const first = await put(owner, CONTENT);
    expect(first.statusCode).toBe(201);
    expect(first.json<AgencyStyleVersion>()).toMatchObject({ ...CONTENT, version: 1, isActive: false });
    const second = await put(owner, { ...CONTENT, publicStyle: '' });
    expect(second.json<AgencyStyleVersion>()).toMatchObject({ version: 2, isActive: false });
    const overview = (await get(owner)).json<AgencyStyleOverview>();
    expect(overview.active).toBeNull();
    expect(overview.versions.map((v) => v.version)).toEqual([2, 1]);
    const audited = await test.admin.db
      .select({ action: schema.auditLog.action, details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'agency_style'));
    expect(audited).toHaveLength(2);
    // The audit names the version, never its texts.
    expect(JSON.stringify(audited)).not.toContain('Phrase de style');
  });

  it('activates one at a time over the active version the screen read, and the agent reads it', async () => {
    const [newest, older] = (await get(owner)).json<AgencyStyleOverview>().versions;
    if (newest === undefined || older === undefined) throw new Error('two versions expected');
    expect((await activate(operator, older.id, null)).statusCode).toBe(403);
    const missing = await activate(owner, '0199f2a0-0000-7000-8000-00000000abcd', null);
    expect([missing.statusCode, ApiErrorSchema.parse(missing.json()).error.code]).toEqual([
      404,
      'agency_style_not_found',
    ]);
    expect((await activate(owner, older.id, null)).json<AgencyStyleVersion>()).toMatchObject({
      id: older.id,
      isActive: true,
    });
    const stale = await activate(owner, newest.id, null);
    expect([stale.statusCode, ApiErrorSchema.parse(stale.json()).error.code]).toEqual([
      409,
      'agency_style_conflict',
    ]);
    expect((await activate(owner, newest.id, older.id)).json<AgencyStyleVersion>()).toMatchObject({
      id: newest.id,
      isActive: true,
    });
    expect((await get(owner)).json<AgencyStyleOverview>().active?.id).toBe(newest.id);
    expect(await app.modules.persona.agencyStyle.activeUnscoped()).toMatchObject({
      id: newest.id,
      publicStyle: '',
      privateStyle: CONTENT.privateStyle,
    });
    const activations = await test.admin.db
      .select({ userId: schema.auditLog.userId })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'agency_style.activate'));
    expect(activations).toHaveLength(2);
  });
});
