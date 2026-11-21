import { LlmCallIdSchema, newId } from '@impera/contracts';
import { schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createPostgresActivityReader } from '../activity.reader';

const NOW = new Date('2026-11-16T14:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe('each service’s real calls (ADR 0091 § 7)', () => {
  let test: TestDb;
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
      ...values,
    });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('counts the last 24 hours and keeps the latest trouble until a success comes after it', async () => {
    await call({ createdAt: hoursAgo(30), status: 'timeout' });
    await call({ createdAt: hoursAgo(3), status: 'ok' });
    await call({ createdAt: hoursAgo(2), status: 'rate_limited' });
    await call({ createdAt: hoursAgo(1), status: 'ok', hedge: 'loser' });
    await call({ createdAt: hoursAgo(1), status: 'invalid_output' });
    await call({
      provider: 'mistral',
      model: 'mistral-large-4',
      createdAt: hoursAgo(5),
      status: 'ok',
      isFallback: true,
    });
    await call({
      provider: 'mistral',
      model: 'mistral-large-4',
      createdAt: hoursAgo(4),
      status: 'quota_exhausted',
      purpose: 'probe',
    });
    await call({ provider: 'google', model: 'gemini-3.8-flash', createdAt: hoursAgo(50), status: 'auth' });
    await call({ provider: 'google', model: 'gemini-3.8-flash', createdAt: hoursAgo(49), status: 'ok' });

    const activity = await createPostgresActivityReader(test.service.db).last24h(NOW);

    expect(activity.get('xai')).toEqual({
      calls: 3,
      troubled: 1,
      asFallback: 0,
      lastSuccessAt: hoursAgo(3).toISOString(),
      lastTrouble: { at: hoursAgo(2).toISOString(), kind: 'rate_limited' },
    });
    expect(activity.get('mistral')).toMatchObject({
      calls: 2,
      troubled: 1,
      asFallback: 1,
      lastTrouble: { kind: 'no_credit' },
    });
    expect(activity.get('google')).toMatchObject({ calls: 0, lastTrouble: null });
  });
});
