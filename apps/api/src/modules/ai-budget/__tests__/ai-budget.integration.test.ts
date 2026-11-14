import { AiBudgetSchema, AiUsageSchema, LlmCallIdSchema, newId } from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { testConfig } from '../../../__tests__/support/config';
import { DASHBOARD_ORIGIN, signIn } from '../../../__tests__/support/sign-in';
import { createOwner } from '../../../auth';
import { createApp, type App } from '../../../composition-root';
import { createLogger } from '../../../logger';
import { buildServer, type Server } from '../../../server';

const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'operator@example.test', name: 'Operator', password: 'staple battery horse' };
const ErrorBodySchema = z.object({ error: z.object({ code: z.string() }) });

/** Réglages › Modèles IA › Budget IA (choix de Charles 12/11): the owner sets the caps the gateway enforces. */
describe('/v1/settings/ai-budget', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let owner: string;

  const read = async (cookie = owner) => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/settings/ai-budget',
      headers: { cookie },
    });
    return {
      status: response.statusCode,
      body: response.statusCode === 200 ? AiBudgetSchema.parse(response.json()) : null,
    };
  };
  const put = (payload: Record<string, unknown>, cookie = owner) =>
    server.inject({
      method: 'PUT',
      url: '/v1/settings/ai-budget',
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      payload,
    });
  /** The gateway's own reading of the day, as Réglages › Consommation IA shows it. */
  const gatewayToday = async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/settings/ai-usage',
      headers: { cookie: owner },
    });
    return AiUsageSchema.parse(response.json()).today;
  };
  const codeOf = (response: { body: string }) => ErrorBodySchema.parse(JSON.parse(response.body)).error.code;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // 11 $ spent today, 10 € at the gateway's rate: journaled before the app starts, so its count of the day has it.
    await test.admin.db.insert(schema.llmCalls).values({
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
    });
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
    expect((await put({ dailyCapMinor: 5000, trendWatchCapMinor: null }, operator)).statusCode).toBe(403);
    expect(await test.admin.db.select().from(schema.aiBudgetSettings)).toHaveLength(0);
  });

  it('reads the code’s defaults while the owner set nothing, with the day’s spend', async () => {
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      dailyCapMinor: 2000,
      trendWatchCapMinor: 100,
      defaults: { dailyCapMinor: 2000, trendWatchCapMinor: 100 },
      isCustom: { dailyCap: false, trendWatchCap: false },
      alertAtMinor: 1600,
      spentTodayMinor: 1000,
      trendWatchSpentTodayMinor: 0,
      state: 'ok',
      updatedAt: null,
    });
  });

  it('refuses values out of bounds, and a watch cap above the day’s budget', async () => {
    expect((await put({ dailyCapMinor: 50, trendWatchCapMinor: null })).statusCode).toBe(400);
    expect((await put({ dailyCapMinor: 20_001, trendWatchCapMinor: null })).statusCode).toBe(400);
    expect((await put({ dailyCapMinor: null, trendWatchCapMinor: 5 })).statusCode).toBe(400);
    const above = await put({ dailyCapMinor: 300, trendWatchCapMinor: 500 });
    expect(above.statusCode).toBe(422);
    expect(codeOf(above)).toBe('ai_budget_unprocessable');
    expect(await test.admin.db.select().from(schema.aiBudgetSettings)).toHaveLength(0);
  });

  it('lowered under the day’s spend, stops the gateway at once and says so; audited', async () => {
    const lowered = await put({ dailyCapMinor: 500, trendWatchCapMinor: 50 });
    expect(lowered.statusCode).toBe(200);
    expect(AiBudgetSchema.parse(lowered.json())).toMatchObject({
      dailyCapMinor: 500,
      trendWatchCapMinor: 50,
      isCustom: { dailyCap: true, trendWatchCap: true },
      alertAtMinor: 400,
      state: 'reached',
    });
    // The gateway reads the same cap: no call goes out until midnight.
    expect(await gatewayToday()).toMatchObject({ capEur: 5, state: 'reached' });

    const raised = await put({ dailyCapMinor: 15_000, trendWatchCapMinor: null });
    expect(AiBudgetSchema.parse(raised.json())).toMatchObject({
      dailyCapMinor: 15_000,
      trendWatchCapMinor: 100,
      isCustom: { dailyCap: true, trendWatchCap: false },
      state: 'ok',
    });
    expect((await gatewayToday()).capEur).toBe(150);

    const audit = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(eq(schema.auditLog.action, 'ai_budget.update'))
      .orderBy(schema.auditLog.createdAt);
    expect(audit.map((line) => line.details)).toEqual([
      {
        before: { dailyCapMinor: null, trendWatchCapMinor: null },
        after: { dailyCapMinor: 500, trendWatchCapMinor: 50 },
      },
      {
        before: { dailyCapMinor: 500, trendWatchCapMinor: 50 },
        after: { dailyCapMinor: 15_000, trendWatchCapMinor: null },
      },
    ]);
  });

  it('goes back to the defaults with null', async () => {
    const reset = await put({ dailyCapMinor: null, trendWatchCapMinor: null });
    expect(AiBudgetSchema.parse(reset.json())).toMatchObject({
      dailyCapMinor: 2000,
      trendWatchCapMinor: 100,
      isCustom: { dailyCap: false, trendWatchCap: false },
    });
    expect((await gatewayToday()).capEur).toBe(20);
  });
});
