import { newId, ScriptQueueSchema, TeamMemberIdSchema } from '@impera/contracts';
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

/** Invented accounts and creators (ADR 0010). */
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MANAGER = { email: 'manager@example.test', name: 'Manager', password: 'staple battery horse' };
const CHATTER = { email: 'chatter@example.test', name: 'Chatter', password: 'battery staple horse' };
const UNKNOWN = '0199f2a0-0000-7000-8000-00000000dead';

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

describe('a creator’s script queue, out of scope (recette SEC-06)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: Record<string, string>;
  let manager: Record<string, string>;
  let chatter: Record<string, string>;
  let hers: string;
  let other: string;

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
    hers = (await app.modules.persona.creators.create({ displayName: 'Lina' })).id;
    other = (await app.modules.persona.creators.create({ displayName: 'Sasha' })).id;
    await createOwner(app.auth, app.db.db, OWNER);
    for (const [account, teamRole] of [
      [MANAGER, 'manager'],
      [CHATTER, 'chatter'],
    ] as const) {
      const { userId } = await createOwner(app.auth, app.db.db, account);
      await test.admin.db
        .update(schema.user)
        .set({ role: 'operator', creatorIds: teamRole === 'chatter' ? [hers] : [] })
        .where(eq(schema.user.id, userId));
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId,
        teamRole,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `Membre ${teamRole}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
    }
    owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    manager = { cookie: await signIn(server, MANAGER.email, MANAGER.password), origin: DASHBOARD_ORIGIN };
    chatter = { cookie: await signIn(server, CHATTER.email, CHATTER.password), origin: DASHBOARD_ORIGIN };
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const queue = (headers: Record<string, string>, creatorId: string) =>
    server.inject({ method: 'GET', url: `/v1/creators/${creatorId}/script-queue`, headers });
  const refusal = async (headers: Record<string, string>, creatorId: string) => {
    const response = await queue(headers, creatorId);
    return [response.statusCode, ErrorBodySchema.parse(response.json()).error.code];
  };

  it('lets the owner and an active manager read any creator’s queue', async () => {
    for (const headers of [owner, manager]) {
      const response = await queue(headers, other);
      expect(response.statusCode).toBe(200);
      expect(ScriptQueueSchema.parse(response.json()).entries).toEqual([]);
    }
    expect(await refusal(owner, UNKNOWN)).toEqual([404, 'script_queue_creator_not_found']);
  });

  it('answers anyone else the same 404 for another creator and for one that does not exist', async () => {
    const outOfScope = await refusal(chatter, other);
    expect(outOfScope).toEqual([404, 'script_queue_creator_not_found']);
    expect(await refusal(chatter, UNKNOWN)).toEqual(outOfScope);
    // Her own creator too: the queue is the agency's (ADR 0056 § 2), the policies never gave him a line of it.
    expect(await refusal(chatter, hers)).toEqual(outOfScope);
  });
});
