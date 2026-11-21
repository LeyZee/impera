import {
  CreatorIdSchema,
  newId,
  PersonaOverviewSchema,
  TeamMemberIdSchema,
  type CreatorId,
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
import { activateDemoPersona } from './support/persona';
import { signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';

/**
 * Who reads her whole sheet (ADR 0153, amendment of 21/11, Charles): the owner and an active manager on the creators of
 * his list; any other operator, a chatter or an operator without a team row, reads the short sheet only. Invented data
 * only (ADR 0010).
 */
describe('her whole sheet, the agency’s (GET /v1/creators/:id/persona)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerCookie: string;
  let accounts = 0;
  const nora: CreatorId = newId(CreatorIdSchema);
  const ines: CreatorId = newId(CreatorIdSchema);

  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;
  const read = (creatorId: string, cookie: string, path = '') =>
    server.inject({ method: 'GET', url: `/v1/creators/${creatorId}/persona${path}`, headers: { cookie } });

  /** An operator whose list holds Nora, with a team row of that role and status, or none. */
  async function operator(team: { role: 'manager' | 'chatter'; status: 'active' | 'on_leave' } | null) {
    accounts += 1;
    const email = `operator-${String(accounts)}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, {
      email,
      name: 'operator',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [nora] })
      .where(eq(schema.user.id, userId));
    if (team !== null)
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId,
        teamRole: team.role,
        status: team.status,
        firstName: 'Prénom',
        lastName: 'Inventé',
        displayName: `membre ${String(accounts)}`,
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-10-01',
      });
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
    for (const [id, label] of [
      [nora, 'nora'],
      [ines, 'ines'],
    ] as const) {
      await test.admin.db
        .insert(schema.creators)
        .values({ id, nameKey: id, displayName: label, timezone: 'Europe/Paris' });
    }
    await activateDemoPersona(app, nora);
    const owner = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
    await createOwner(app.auth, app.db.db, owner);
    ownerCookie = await signIn(server, owner.email, owner.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('shows it to the owner, with the objection replies', async () => {
    const response = await read(nora, ownerCookie);
    expect(response.statusCode, response.body).toBe(200);
    expect(PersonaOverviewSchema.parse(response.json()).versions.length).toBeGreaterThan(0);
  });

  it('shows it to an active manager on a creator of his list, never on another', async () => {
    const manager = await operator({ role: 'manager', status: 'active' });
    const response = await read(nora, manager);
    expect(response.statusCode, response.body).toBe(200);
    PersonaOverviewSchema.parse(response.json());
    const elsewhere = await read(ines, manager);
    expect([elsewhere.statusCode, codeOf(elsewhere)]).toEqual([403, 'creator_forbidden']);
  });

  it('refuses it to a chatter, a manager away and an operator without a team row: theirs is the short sheet', async () => {
    for (const team of [
      { role: 'chatter', status: 'active' },
      { role: 'manager', status: 'on_leave' },
      null,
    ] as const) {
      const cookie = await operator(team);
      const refused = await read(nora, cookie);
      expect(refused.statusCode, JSON.stringify(team)).toBe(403);
      expect(refused.body).not.toContain('"strategies"');
    }
    // The operator without a team row keeps his list: the short sheet stays his.
    const plain = await operator(null);
    expect(codeOf(await read(nora, plain))).toBe('persona_full_forbidden');
    expect((await read(nora, plain, '/chatter')).statusCode).toBe(200);
  });
});
