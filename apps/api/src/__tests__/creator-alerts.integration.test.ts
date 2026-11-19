import {
  CreatorAlertLineSchema,
  CreatorAlertsViewSchema,
  CREATOR_ALERT_DEFAULTS,
  TeamMemberSchema,
} from '@impera/contracts';
import { eq, schema, withTenant } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { parisDay } from './support/paris';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const CREATOR = { email: 'creator@example.test', name: 'Creator', password: 'battery staple correct' };
const MANAGER_PASSWORD = 'horse correct staple battery';

const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

describe('the Alertes tab of her sheet (ADR 0150, /v1/creators/:creatorId/alerts)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let nora: string;
  let iris: string;
  const headers: Record<'owner' | 'manager' | 'operator' | 'creator', Record<string, string>> = {
    owner: {},
    manager: {},
    operator: {},
    creator: {},
  };

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
    nora = (await app.modules.persona.creators.create({ displayName: 'Nora' })).id;
    iris = (await app.modules.persona.creators.create({ displayName: 'Iris' })).id;
    for (const [account, role] of [
      [OPERATOR, 'operator'],
      [CREATOR, 'creator'],
    ] as const) {
      const { userId } = await createOwner(app.auth, app.db.db, account);
      await test.admin.db
        .update(schema.user)
        .set({ role, creatorIds: [nora] })
        .where(eq(schema.user.id, userId));
    }
    headers.owner = { cookie: await signIn(server, OWNER.email, OWNER.password), origin: DASHBOARD_ORIGIN };
    headers.operator = {
      cookie: await signIn(server, OPERATOR.email, OPERATOR.password),
      origin: DASHBOARD_ORIGIN,
    };
    headers.creator = {
      cookie: await signIn(server, CREATOR.email, CREATOR.password),
      origin: DASHBOARD_ORIGIN,
    };
    // An active manager of the agency: the role most tempted by this tab, refused all the same (relecture Sécurité).
    const invited = await server.inject({
      method: 'POST',
      url: '/v1/team/members',
      headers: headers.owner,
      payload: {
        email: 'manager@example.test',
        displayName: 'Manager',
        firstName: 'Manon',
        lastName: 'Inventée',
        teamRole: 'manager',
        creatorIds: [nora, iris],
        country: 'FR',
        timeZone: 'Europe/Paris',
        joinedOn: parisDay(-30),
        commission: { rateBps: 1000 },
        teamShareBps: 500,
      },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    const member = TeamMemberSchema.parse(invited.json());
    const context = await app.auth.$context;
    await context.internalAdapter.linkAccount({
      userId: member.userId,
      providerId: 'credential',
      accountId: member.userId,
      password: await context.password.hash(MANAGER_PASSWORD),
    });
    headers.manager = {
      cookie: await signIn(server, 'manager@example.test', MANAGER_PASSWORD),
      origin: DASHBOARD_ORIGIN,
    };
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  const view = (who: keyof typeof headers, creatorId: string) =>
    server.inject({ method: 'GET', url: `/v1/creators/${creatorId}/alerts`, headers: headers[who] });
  const put = (who: keyof typeof headers, creatorId: string, code: string, routes: object) =>
    server.inject({
      method: 'PUT',
      url: `/v1/creators/${creatorId}/alerts/${code}`,
      headers: headers[who],
      payload: { routes },
    });
  const quiet = { owner: 'deliver', manager: 'off', chatter_on_shift: 'muted' };

  it('is the owner’s alone: never a manager’s, an operator’s, nor hers', async () => {
    for (const who of ['manager', 'operator', 'creator'] as const) {
      expect((await view(who, nora)).statusCode).toBe(403);
      expect((await put(who, nora, 'sale', quiet)).statusCode).toBe(403);
    }
  });

  it('shows the defaults of the code, then the owner’s choice, for her alone', async () => {
    const before = CreatorAlertsViewSchema.parse((await view('owner', nora)).json());
    expect(before.alerts.find((line) => line.code === 'sale')).toMatchObject({
      isDefault: true,
      routes: CREATOR_ALERT_DEFAULTS.sale,
    });

    const written = await put('owner', nora, 'sale', quiet);
    expect(written.statusCode).toBe(200);
    expect(CreatorAlertLineSchema.parse(written.json())).toMatchObject({ isDefault: false, routes: quiet });
    // The same choice again changes nothing.
    expect(CreatorAlertLineSchema.parse((await put('owner', nora, 'sale', quiet)).json()).routes).toEqual(
      quiet,
    );

    const after = CreatorAlertsViewSchema.parse((await view('owner', nora)).json());
    expect(after.alerts.find((line) => line.code === 'sale')?.routes).toEqual(quiet);
    // Isolation: another creator keeps her defaults, and RLS keeps the rows to Nora.
    const other = CreatorAlertsViewSchema.parse((await view('owner', iris)).json());
    expect(other.alerts.find((line) => line.code === 'sale')?.isDefault).toBe(true);
    const rowsOf = (creatorId: string) =>
      withTenant(app.db.db, creatorId, (tx) =>
        tx.select({ creatorId: schema.creatorAlertRoutes.creatorId }).from(schema.creatorAlertRoutes),
      );
    expect((await rowsOf(nora)).every((row) => row.creatorId === nora)).toBe(true);
    expect(await rowsOf(iris)).toEqual([]);

    const audits = await test.admin.db
      .select({ action: schema.auditLog.action })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entity, 'creator_alert_route'));
    // The same choice sent twice writes one audit line.
    expect(audits.length).toBe(1);
  });

  it('never mutes nor switches off a safety relay, and the base refuses it too', async () => {
    const refused = await put('owner', nora, 'safety_handoff', quiet);
    expect(refused.statusCode).toBe(422);
    expect(ErrorBodySchema.parse(refused.json()).error.code).toBe('creator_alert_locked_unprocessable');
    await expect(
      test.admin.db.insert(schema.creatorAlertRoutes).values({
        creatorId: nora,
        alertCode: 'safety_handoff',
        role: 'chatter_on_shift',
        mode: 'off',
        updatedBy:
          (await test.admin.db.select({ id: schema.user.id }).from(schema.user).limit(1))[0]?.id ?? '',
      }),
    ).rejects.toThrow();
  });

  it('answers 404 for a creator that does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(ErrorBodySchema.parse((await view('owner', missing)).json()).error.code).toBe(
      'creator_alert_creator_not_found',
    );
    expect((await put('owner', missing, 'sale', quiet)).statusCode).toBe(404);
  });
});
