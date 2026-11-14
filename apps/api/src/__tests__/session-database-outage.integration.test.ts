import { createServer, Socket, type Server as TcpServer } from 'node:net';

import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };

/**
 * A TCP relay in front of Postgres, so a test can cut the database off as a restart would: `cut()` drops every
 * connection and refuses new ones.
 */
async function relayTo(
  target: URL,
): Promise<{ url(of: string): string; cut(): void; close(): Promise<void> }> {
  const sockets = new Set<Socket>();
  let isCut = false;
  const relay: TcpServer = createServer((client) => {
    if (isCut) {
      client.destroy();
      return;
    }
    const upstream = new Socket();
    upstream.connect(Number(target.port || 5432), target.hostname);
    for (const socket of [client, upstream]) {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.on('error', () => socket.destroy());
    }
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((resolve) => relay.listen(0, '127.0.0.1', resolve));
  const address = relay.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url(of) {
      const url = new URL(of);
      url.hostname = '127.0.0.1';
      url.port = String(port);
      return url.toString();
    },
    cut() {
      isCut = true;
      for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise((resolve) =>
        relay.close(() => {
          resolve();
        }),
      ),
  };
}

describe('a signed-in request while the database is down (recette 07/11, BIL-01)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let relay: Awaited<ReturnType<typeof relayTo>>;
  let cookie = '';

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    relay = await relayTo(new URL(test.appUrl));
    const config = testConfig({
      DATABASE_URL: relay.url(test.appUrl),
      DATABASE_SERVICE_URL: test.serviceUrl,
    });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    await createOwner(app.auth, app.db.db, OWNER);
    cookie = await signIn(server, OWNER.email, OWNER.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await relay.close();
    await test.close();
  });

  it('answers 503 « réessaie », not 500 « Erreur interne », on every route that reads the session', async () => {
    const before = await server.inject({ method: 'GET', url: '/v1/me', headers: { cookie } });
    expect(before.statusCode, before.body).toBe(200);

    relay.cut();
    for (const url of ['/v1/session', '/v1/me', '/v1/creators']) {
      const response = await server.inject({
        method: 'GET',
        url,
        headers: { cookie, origin: DASHBOARD_ORIGIN },
      });
      expect(response.statusCode, `${url}: ${response.body}`).toBe(503);
      expect(response.json<{ error: { code: string } }>().error.code).toBe('service_unavailable');
    }
  });
});
