import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createApp } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { MethodSchema, namesOf, routesOf } from './support/routes';

/**
 * Every route that writes, asked from another site or with no `Origin` (security.md § 6, audit des tests d'isolation,
 * 06/11): it answers 403 `origin_forbidden` before anything else, but for the routes listed here, each authenticated
 * otherwise. Read from the server, so a route added tomorrow with `originCheck: false` fails this test until listed.
 */
const NO_ORIGIN_CHECK: Readonly<Record<string, string>> = {
  'POST /v1/connector/sessions': 'the extension’s « Sync », by the owner’s link token',
  'POST /v1/copilot/drafts/:draftId/verdict': 'the extension’s copilot panel, by its link token',
  'POST /v1/trends/readings': 'the extension, by its link token',
  'POST /v1/trends/readings/captures': 'the extension, by its link token',
  'POST /v1/webhooks/sales-feeds/:platform': 'the platform’s webhook, checked by its signature',
};

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const RefusalSchema = z.object({ error: z.object({ code: z.string() }) });

/** A body read as JSON when it is, else nothing: a route that answers otherwise is named, never a thrown parse. */
function jsonOf(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

describe('no write comes from another site (audit des tests d’isolation, 06/11)', () => {
  let test: TestDb;
  let server: Server;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    const app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
  });

  afterAll(async () => {
    await server.close();
    await test.close();
  });

  it('refuses every write from a foreign origin or none, but the routes authenticated otherwise', async () => {
    const all = routesOf(server.printRoutes({ commonPrefix: false }));
    // A wildcard has no single path to ask: one that comes is swept by a concrete path, not skipped (relecture #595).
    expect(all.filter((route) => route.path.includes('*'))).toEqual([]);
    const routes = all.filter((route) => WRITES.has(route.method));
    expect(routes.length).toBeGreaterThan(100);
    const unchecked = new Set<string>();
    let asked = 0;
    for (const route of routes) {
      const url = route.path
        .split('/')
        .map((segment) => (namesOf(segment).length === 0 ? segment : '00000000-0000-4000-8000-000000000000'))
        .join('/');
      for (const origin of ['https://ailleurs.example', undefined]) {
        asked += 1;
        const response = await server.inject({
          method: MethodSchema.parse(route.method),
          url,
          headers: origin === undefined ? {} : { origin },
          remoteAddress: `10.2.${String(Math.floor(asked / 250))}.${String(asked % 250)}`,
          ...(route.method !== 'DELETE' && { payload: {} }),
        });
        const refusal = RefusalSchema.safeParse(jsonOf(response.body));
        const refused =
          response.statusCode === 403 && refusal.success && refusal.data.error.code === 'origin_forbidden';
        if (!refused) unchecked.add(`${route.method} ${route.path}`);
      }
    }
    expect([...unchecked].sort()).toEqual(Object.keys(NO_ORIGIN_CHECK).sort());
  });
});
