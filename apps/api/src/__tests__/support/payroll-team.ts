import {
  AccountPayRulesIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  ShiftReportIdSchema,
  TeamMemberSchema,
  type CreatorId,
  type PayPeriod,
  type PlatformAccountId,
  type ShiftReportId,
  type TeamMember,
  type TeamRole,
} from '@nirvana/contracts';
import { and, eq, schema, sql } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { LightMyRequestResponse } from 'fastify';
import type { PoolClient } from 'pg';
import { expect } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../../auth';
import { createApp, type App } from '../../composition-root';
import { createLogger } from '../../logger';
import { buildServer, type Server } from '../../server';

import { testConfig } from './config';
import { lockWaits } from './lock-waits';
import { DASHBOARD_ORIGIN, signIn } from './sign-in';

/**
 * A team for the pay tests (EQ-04): the owner, two creators with one account each, and members added on demand, on
 * a server of their own. Invented people, creators and accounts only (ADR 0010).
 */
export interface PayrollTeam {
  readonly test: TestDb;
  readonly app: App;
  readonly server: Server;
  readonly ownerId: string;
  /** The owner's `cookie` header. */
  readonly owner: string;
  readonly anna: CreatorId;
  readonly bea: CreatorId;
  readonly annas: PlatformAccountId;
  readonly beas: PlatformAccountId;
  call(
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    cookie: string,
    payload?: object,
    via?: Server,
  ): Promise<LightMyRequestResponse>;
  /** A member on both creators at 20 % from their arrival (2025-01-01 unless said), signed in. */
  addMember(
    email: string,
    displayName: string,
    teamRole?: TeamRole,
    joinedOn?: string,
  ): Promise<{ readonly member: TeamMember; readonly cookie: string }>;
  /** A report of `member` for `period`, as the planning leaves it: validated unless said otherwise. */
  report(
    member: TeamMember,
    period: PayPeriod,
    amountMinor: number,
    options?: {
      readonly account?: PlatformAccountId;
      readonly status?: 'validated' | 'submitted';
      readonly currency?: 'EUR' | 'USD';
    },
  ): Promise<ShiftReportId>;
  recalculate(period: PayPeriod): ReturnType<App['modules']['payroll']['jobs']['recalculate']>;
  statementOf(
    member: TeamMember,
    period: PayPeriod,
  ): Promise<typeof schema.commissionStatements.$inferSelect>;
  validate(
    cookie: string,
    member: TeamMember,
    period: PayPeriod,
    via?: Server,
  ): Promise<LightMyRequestResponse>;
  /** The `error` of a refused answer. */
  refusal(response: { json: () => unknown }): { readonly code: string; readonly details?: unknown };
  closingOf(period: PayPeriod): Promise<typeof schema.payPeriodClosings.$inferSelect | undefined>;
  /** The payloads of the `payroll.recalculate` jobs waiting for `period`. */
  jobsFor(period: PayPeriod): Promise<unknown[]>;
  forgetJobs(period: PayPeriod): Promise<unknown>;
  /** How many advisory locks some transaction of this test's database waits for: a write held behind another. */
  waiting(): Promise<number>;
  /** Waits until `check` holds, five seconds at most. */
  until(check: () => Promise<boolean>): Promise<void>;
  /** A transaction that holds pay's locks, as a validation or another write would, until `release`. */
  holding(keys: readonly string[]): Promise<{ readonly release: () => Promise<void> }>;
  /** How many lines of the audit log say `action`. */
  audited(action: string): Promise<number>;
  close(): Promise<void>;
}

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const PASSWORD = 'staple battery horse';
const quiet = { warn: () => undefined, error: () => undefined };
const RefusalSchema = z.object({ error: z.object({ code: z.string(), details: z.unknown() }) });

export async function startPayrollTeam(superuserUrl: string): Promise<PayrollTeam> {
  const test = await createTestDb(superuserUrl);
  const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
  const app = await createApp(config, createLogger(config));
  const server = await buildServer({
    config,
    logger: createLogger(config),
    routes: app.routes,
    readiness: app.readiness,
  });
  const { userId: ownerId } = await createOwner(app.auth, app.db.db, OWNER);
  const anna = (await app.modules.persona.creators.create({ displayName: 'Anna' })).id;
  const bea = (await app.modules.persona.creators.create({ displayName: 'Béa' })).id;
  const annas = newId(PlatformAccountIdSchema);
  const beas = newId(PlatformAccountIdSchema);
  const creatorOf = (account: PlatformAccountId): CreatorId => (account === annas ? anna : bea);
  await test.admin.db.insert(schema.platformAccounts).values([
    { id: annas, creatorId: anna, platform: 'reveal', handle: 'anna-invente' },
    { id: beas, creatorId: bea, platform: 'reveal', handle: 'bea-inventee' },
  ]);
  await test.admin.db.insert(schema.accountPayRules).values(
    [annas, beas].map((account) => ({
      id: newId(AccountPayRulesIdSchema),
      creatorId: creatorOf(account),
      platformAccountId: account,
      fromPeriod: '2020-01-01',
      currency: 'EUR',
      vatBps: 0,
      platformFeeBps: 2_000,
      earningsSource: 'declared',
      createdBy: ownerId,
    })),
  );
  const owner = await signIn(server, OWNER.email, OWNER.password);
  let hour = 0;

  const call: PayrollTeam['call'] = (method, url, cookie, payload, via) =>
    (via ?? server).inject({
      method,
      url: `/v1${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload !== undefined && { payload }),
    });

  const statementOf: PayrollTeam['statementOf'] = async (member, period) => {
    const [found] = await test.admin.db
      .select()
      .from(schema.commissionStatements)
      .where(
        and(
          eq(schema.commissionStatements.memberId, member.id),
          eq(schema.commissionStatements.period, period),
        ),
      );
    if (found === undefined) throw new Error('no statement');
    return found;
  };

  return {
    test,
    app,
    server,
    ownerId,
    owner,
    anna,
    bea,
    annas,
    beas,
    call,

    async addMember(email, displayName, teamRole = 'chatter', joinedOn = '2025-01-01') {
      const response = await call('POST', '/team/members', owner, {
        email,
        displayName,
        teamRole,
        creatorIds: [anna, bea],
        firstName: displayName,
        lastName: 'Inventé',
        country: 'FR',
        timeZone: 'Europe/Paris',
        joinedOn,
        commission: { rateBps: 2_000 },
        teamShareBps: null,
      });
      expect(response.statusCode, response.body).toBe(201);
      const member = TeamMemberSchema.parse(response.json());
      const context = await app.auth.$context;
      await context.internalAdapter.linkAccount({
        userId: member.userId,
        providerId: 'credential',
        accountId: member.userId,
        password: await context.password.hash(PASSWORD),
      });
      return { member, cookie: await signIn(server, email, PASSWORD) };
    },

    async report(
      member,
      period,
      amountMinor,
      { account = annas, status = 'validated', currency = 'EUR' } = {},
    ) {
      const shiftId = newId(ShiftIdSchema);
      hour += 3;
      const startsAt = new Date(`${period}T06:00:00Z`);
      startsAt.setUTCHours(startsAt.getUTCHours() + (hour % 200));
      await test.admin.db.insert(schema.shifts).values({
        id: shiftId,
        creatorId: creatorOf(account),
        platformAccountId: account,
        memberId: member.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
        createdBy: ownerId,
        updatedBy: ownerId,
      });
      const id = newId(ShiftReportIdSchema);
      await test.admin.db.insert(schema.shiftReports).values({
        id,
        creatorId: creatorOf(account),
        platformAccountId: account,
        shiftId,
        memberId: member.id,
        period,
        amountMinor,
        currency,
        status,
        submittedBy: member.userId,
        submittedAt: startsAt,
        reviewedBy: status === 'validated' ? ownerId : null,
        reviewedAt: status === 'validated' ? startsAt : null,
        createdBy: member.userId,
      });
      return id;
    },

    recalculate: (period) => app.modules.payroll.jobs.recalculate(period, quiet),

    statementOf,

    async validate(cookie, member, period, via) {
      const { id, revision } = await statementOf(member, period);
      return call('POST', `/payroll/statements/${id}/validate`, cookie, { revision }, via);
    },

    refusal: (response) => RefusalSchema.parse(response.json()).error,

    async closingOf(period) {
      const [closing] = await test.admin.db
        .select()
        .from(schema.payPeriodClosings)
        .where(eq(schema.payPeriodClosings.period, period));
      return closing;
    },

    async jobsFor(period) {
      const jobs = await test.admin.db.execute<{ payload: unknown }>(
        sql`select payload from graphile_worker._private_jobs where key = ${`payroll.recalculate:${period}`}`,
      );
      return jobs.rows.map((row) => row.payload);
    },

    forgetJobs: (period) =>
      test.admin.db.execute(
        sql`delete from graphile_worker._private_jobs where key = ${`payroll.recalculate:${period}`}`,
      ),

    waiting: () => lockWaits(test.admin.db),

    async until(check) {
      for (let tries = 0; tries < 250; tries += 1) {
        if (await check()) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Never happened');
    },

    async holding(keys) {
      const client: PoolClient = await test.admin.pool.connect();
      await client.query('begin');
      for (const key of keys)
        await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
      return {
        release: async () => {
          await client.query('rollback');
          client.release();
        },
      };
    },

    async audited(action) {
      const rows = await test.admin.db
        .select({ id: schema.auditLog.id })
        .from(schema.auditLog)
        .where(eq(schema.auditLog.action, action));
      return rows.length;
    },

    async close() {
      await server.close();
      await app.shutdown();
      await test.close();
    },
  };
}
