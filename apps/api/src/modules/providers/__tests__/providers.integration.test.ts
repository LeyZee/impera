import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { testConfig } from '../../../__tests__/support/config';
import { DASHBOARD_ORIGIN, signIn } from '../../../__tests__/support/sign-in';
import { createOwner } from '../../../auth';
import { createApp, type App } from '../../../composition-root';
import { createLogger } from '../../../logger';
import { buildServer, type Server } from '../../../server';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };

/** The Services section through the real app: Better Auth session, Origin check, admin connection. */
describe('/v1/settings/providers in the app (P3-03)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 7).toString('base64')}`,
    });
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
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('is closed without a session and to an operator', async () => {
    const anonymous = await server.inject({ method: 'GET', url: '/v1/settings/providers' });
    expect(anonymous.statusCode).toBe(401);
    const cookie = await signIn(server, OPERATOR.email, OPERATOR.password);
    const operator = await server.inject({
      method: 'GET',
      url: '/v1/settings/providers',
      headers: { cookie },
    });
    expect(operator.statusCode).toBe(403);
  });

  it('shows the owner the three services and refuses a cut key before any network call', async () => {
    const cookie = await signIn(server, OWNER.email, OWNER.password);
    const list = await server.inject({ method: 'GET', url: '/v1/settings/providers', headers: { cookie } });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ next: { kind: 'connect', provider: 'xai' } });

    const cut = await server.inject({
      method: 'PUT',
      url: '/v1/settings/providers/xai/key',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload: { key: 'xai-short' },
    });
    expect(cut.statusCode).toBe(422);
    expect(cut.json()).toMatchObject({ kind: 'too_short' });
  });

  it('refuses a key change from another origin', async () => {
    const cookie = await signIn(server, OWNER.email, OWNER.password);
    const response = await server.inject({
      method: 'DELETE',
      url: '/v1/settings/providers/xai',
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(response.statusCode).toBe(403);
  });
});
