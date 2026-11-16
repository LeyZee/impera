import {
  BonusIdSchema,
  CommissionStatementIdSchema,
  CreatorIdSchema,
  newId,
  PenaltyIdSchema,
  TeamMemberIdSchema,
} from '@impera/contracts';
import { schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };

const member = newId(TeamMemberIdSchema);
const creator = newId(CreatorIdSchema);

/**
 * Every write of a member, a rate or pay (EQ-15, Charles's rule on sensitive gestures): the password and the code
 * given on this session in the last 10 minutes, as for a key (ADR 0046 § 3). Checked before the body is read.
 */
const GUARDED: readonly (readonly ['POST' | 'PATCH' | 'PUT', string])[] = [
  ['POST', '/v1/team/members'],
  ['PATCH', `/v1/team/members/${member}`],
  ['PUT', `/v1/team/members/${member}/status`],
  ['POST', `/v1/team/members/${member}/commission`],
  ['POST', `/v1/team/members/${member}/role`],
  ['POST', '/v1/team/commission-presets'],
  ['POST', '/v1/team/pay-rules'],
  ['POST', `/v1/creators/${creator}/agency-rates`],
  ['POST', `/v1/payroll/statements/${newId(CommissionStatementIdSchema)}/validate`],
  ['POST', `/v1/payroll/statements/${newId(CommissionStatementIdSchema)}/pay`],
  ['POST', '/v1/payroll/bonuses'],
  ['POST', `/v1/payroll/bonuses/${newId(BonusIdSchema)}/cancel`],
  ['POST', '/v1/payroll/penalties'],
  ['POST', `/v1/payroll/penalties/${newId(PenaltyIdSchema)}/cancel`],
  ['POST', '/v1/payroll/adjustments'],
  ['POST', '/v1/payroll/bonus-tiers'],
  ['POST', '/v1/payroll/collective-goals'],
  ['POST', '/v1/payroll/payout-minimums'],
  ['PUT', '/v1/payroll/settings'],
];

describe('the sensitive gestures of team, rates and pay (EQ-15)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;

  const send = (method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, payload?: Record<string, unknown>) =>
    server.inject({
      method,
      url,
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });

  const staleConfirmation = () =>
    test.admin.db.update(schema.session).set({ reauthenticatedAt: sql`now() - interval '11 minutes'` });

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
    owner = await signIn(server, OWNER.email, OWNER.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('asks for the password and the code again on every write of a member, a rate or pay', async () => {
    await staleConfirmation();
    for (const [method, url] of GUARDED) {
      const response = await send(method, url, {});
      expect([
        `${method} ${url}`,
        response.statusCode,
        response.json<{ error: { code: string } }>().error.code,
      ]).toEqual([`${method} ${url}`, 403, 'reauthentication_forbidden']);
    }
    // Reading stays open: only what writes asks again.
    expect((await send('GET', '/v1/team/members')).statusCode).toBe(200);
    expect((await send('GET', '/v1/payroll/settings')).statusCode).toBe(200);
    // Nothing was written meanwhile.
    expect(await test.admin.db.select().from(schema.payrollSettings)).toEqual([]);
  });

  it('lets the write through once the password and the code were given again', async () => {
    await staleConfirmation();
    owner = await signIn(server, OWNER.email, OWNER.password);
    const saved = await send('PUT', '/v1/payroll/settings', { payoutDelayBusinessDays: 5 });
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toMatchObject({ payoutDelayBusinessDays: 5 });
  });
});
