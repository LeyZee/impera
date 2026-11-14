import { randomUUID } from 'node:crypto';

import { AiUsageSchema, LlmCallIdSchema, newId } from '@impera/contracts';
import { and, eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { testConfig } from '../../../__tests__/support/config';
import { DASHBOARD_ORIGIN, signIn } from '../../../__tests__/support/sign-in';
import { createOwner } from '../../../auth';
import { createApp, type App } from '../../../composition-root';
import { createLogger } from '../../../logger';
import { buildServer, type Server } from '../../../server';
import { createPostgresCreditAlerts, createPostgresUsageReader } from '../infra/postgres';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

/** Réglages › Consommation IA (ADR 0091): the journal summed and the credits ledger, the owner's alone. */
describe('/v1/settings/ai-usage', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;

  const read = async (cookie = owner) => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/settings/ai-usage',
      headers: { cookie },
    });
    return {
      status: response.statusCode,
      body: response.statusCode === 200 ? AiUsageSchema.parse(response.json()) : null,
    };
  };
  const add = (payload: Record<string, unknown>, cookie = owner) =>
    server.inject({
      method: 'POST',
      url: '/v1/settings/ai-usage/credits',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;
  /** A call as the gateway journals it, invented. */
  const call = (values: Partial<typeof schema.llmCalls.$inferInsert>) =>
    test.admin.db.insert(schema.llmCalls).values({
      id: newId(LlmCallIdSchema),
      role: 'voice',
      provider: 'xai',
      model: 'grok-4.7',
      promptHash: 'hash-invente',
      latencyMs: 900,
      status: 'ok',
      inputTokens: 1200,
      outputTokens: 80,
      costMicroUsd: 11_000_000,
      ...values,
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
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('is closed to an operator, reading or writing', async () => {
    const operator = await signIn(server, OPERATOR.email, OPERATOR.password);
    expect((await read(operator)).status).toBe(403);
    const refused = await add(
      { id: randomUUID(), provider: 'xai', kind: 'topup', amountMinor: 5000, currency: 'USD' },
      operator,
    );
    expect(refused.statusCode).toBe(403);
    expect(await test.admin.db.select().from(schema.aiCreditEntries)).toHaveLength(0);
  });

  it('sums the journal by day, model and use, with a billed call of unknown cost at the estimate', async () => {
    await call({});
    await call({ role: 'sense', provider: 'google', model: 'gemini-3.8-flash', costMicroUsd: 1_100_000 });
    // Billed without a known cost: counted at the gateway's 0,05 $; refused before any work: nothing.
    await call({ costMicroUsd: null, status: 'timeout' });
    await call({ costMicroUsd: null, status: 'auth' });
    await call({
      purpose: 'trend_watch',
      costMicroUsd: 2_200_000,
      createdAt: new Date(Date.now() - 3 * 86_400_000),
    });
    const { status, body } = await read();
    expect(status).toBe(200);
    const today = body?.days.at(-1);
    expect(today?.calls).toBe(4);
    expect(today?.eur).toBeCloseTo((11 + 1.1 + 0.05) / 1.1, 4);
    expect(body?.models[0]).toMatchObject({ provider: 'xai', model: 'grok-4.7', calls: 4, failed: 2 });
    expect(body?.uses.map((u) => u.use)).toEqual(['voice', 'trend_watch', 'sense']);
    expect(body?.pace.perDayOver).toBe(3);
    expect(body?.credits).toEqual([]);
  });

  it('writes a top-up once with its audit line, refuses a changed replay and a date in the future', async () => {
    const id = randomUUID();
    const line = { id, provider: 'xai', kind: 'topup', amountMinor: 5000, currency: 'USD' };
    expect((await add(line)).statusCode).toBe(201);
    expect((await add(line)).statusCode).toBe(200);
    const changed = await add({ ...line, amountMinor: 6000 });
    expect([changed.statusCode, codeOf(changed)]).toEqual([409, 'ai_credit_conflict']);
    const ahead = await add({
      ...line,
      id: randomUUID(),
      at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect([ahead.statusCode, codeOf(ahead)]).toEqual([422, 'ai_credit_in_future_unprocessable']);
    const zero = await add({ ...line, id: randomUUID(), amountMinor: 0 });
    expect(zero.statusCode).toBe(400);
    const audit = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'ai_credit.add'), eq(schema.auditLog.entityId, id)));
    expect(audit).toHaveLength(1);

    const { body } = await read();
    const [card] = body?.credits ?? [];
    expect(card).toMatchObject({ provider: 'xai', currency: 'USD', balanceMinor: 5000 });

    const removed = await server.inject({
      method: 'DELETE',
      url: `/v1/settings/ai-usage/credits/${id}`,
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
    });
    expect(removed.statusCode).toBe(204);
    // Taken back like it was written: one audit line each way.
    const removal = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(and(eq(schema.auditLog.action, 'ai_credit.remove'), eq(schema.auditLog.entityId, id)));
    expect(removal).toHaveLength(1);
    const again = await server.inject({
      method: 'DELETE',
      url: `/v1/settings/ai-usage/credits/${id}`,
      headers: { cookie: owner, origin: DASHBOARD_ORIGIN },
    });
    expect([again.statusCode, codeOf(again)]).toEqual([404, 'ai_credit_not_found']);
  });

  it('counts down the calls made after a balance reading', async () => {
    const at = new Date(Date.now() - 60_000).toISOString();
    expect(
      (
        await add({
          id: randomUUID(),
          provider: 'mistral',
          kind: 'balance',
          amountMinor: 1000,
          currency: 'USD',
          at,
        })
      ).statusCode,
    ).toBe(201);
    await call({ provider: 'mistral', model: 'mistral-large-4', costMicroUsd: 2_500_000 });
    const card = (await read()).body?.credits.find((c) => c.provider === 'mistral');
    expect(card).toMatchObject({ balanceMinor: 750, spentSinceMinor: 250 });
  });

  it('publishes one alert per provider, level and line', async () => {
    const alerts = createPostgresCreditAlerts(test.service.db);
    const payload = {
      provider: 'xai',
      level: 'low',
      balanceMinor: 900,
      currency: 'USD',
      daysLeft: 3,
      runsOutOn: '2026-11-14',
      entryId: randomUUID(),
    } as const;
    const since = new Date(Date.now() - 60_000);
    expect(await alerts.publish(payload, since)).toBe(true);
    expect(await alerts.publish(payload, since)).toBe(false);
    expect(await alerts.publish({ ...payload, level: 'critical' }, since)).toBe(true);
    const rows = await test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'ai_credits_low'));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.creatorId === null)).toBe(true);
  });
  it('notes a subscription without an amount, and shows it as included (ADR 0091 § 6)', async () => {
    const refused = await add({
      id: randomUUID(),
      provider: 'google',
      kind: 'subscription',
      amountMinor: 500,
      currency: 'USD',
    });
    expect(refused.statusCode).toBe(400);
    const created = await add({
      id: randomUUID(),
      provider: 'google',
      kind: 'subscription',
      amountMinor: 0,
      currency: 'USD',
    });
    expect(created.statusCode).toBe(201);
    const card = (await read()).body?.credits.find((c) => c.provider === 'google');
    expect(card).toMatchObject({
      mode: 'subscription',
      state: 'included',
      balanceMinor: 0,
      quotaRefusedAt: null,
    });
  });

  it('finds the first refusal for lack of quota since the last answer, and alerts once per episode', async () => {
    const reader = createPostgresUsageReader(test.service.db);
    const alerts = createPostgresCreditAlerts(test.service.db);
    // Ahead of the calls the other tests journaled just now: this episode is the latest one.
    const at = (s: number) => new Date(Date.now() + s * 1000);
    await call({ provider: 'google', model: 'gemini-x', status: 'ok', createdAt: at(1) });
    const firstRefusal = at(2);
    await call({
      provider: 'google',
      model: 'gemini-x',
      status: 'quota_exhausted',
      costMicroUsd: null,
      createdAt: firstRefusal,
    });
    await call({
      provider: 'google',
      model: 'gemini-x',
      status: 'quota_exhausted',
      costMicroUsd: null,
      createdAt: at(3),
    });
    const first = await reader.quotaRefusedAt('google');
    expect(first?.getTime()).toBe(firstRefusal.getTime());
    const card = (await read()).body?.credits.find((c) => c.provider === 'google');
    expect(card).toMatchObject({ state: 'quota_reached' });
    const payload = {
      provider: 'google',
      mode: 'subscription',
      refusedAt: first?.toISOString() ?? '',
    } as const;
    expect(await alerts.publishQuota(payload)).toBe(true);
    expect(await alerts.publishQuota(payload)).toBe(false);
    // An answer ends the episode.
    await call({ provider: 'google', model: 'gemini-x', status: 'ok', createdAt: at(10) });
    expect(await reader.quotaRefusedAt('google')).toBeNull();
    const rows = await test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'ai_quota_exhausted'));
    expect(rows).toHaveLength(1);
  });
});
