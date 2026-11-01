import { CreatorIdSchema, newId } from '@nirvana/contracts';
import { schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import type { LlmCallRecord, LlmCallStore } from '@nirvana/llm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDrizzleLlmCallStore } from '../llm-call-store';

function call(overrides: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return {
    at: new Date(),
    role: 'voice',
    provider: 'xai',
    model: 'grok-test',
    promptHash: 'hash',
    outcome: 'ok',
    latencyMs: 812.4,
    isFallback: false,
    inputTokens: 1_200,
    outputTokens: 80,
    costUsd: 0.000_734,
    ...overrides,
  };
}

describe('llm_calls as the gateway journal (LlmCallStore)', () => {
  let test: TestDb;
  let store: LlmCallStore;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    store = createDrizzleLlmCallStore(test.admin.db);
  });

  afterAll(async () => {
    await test.close();
  });

  it('keeps fractions of a cent, every outcome, and calls with or without a creator', async () => {
    const creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    const start = new Date(Date.now() - 1_000);
    // A draft id no draft has yet: the calls come before the draft.
    await store.insert({ ...call({ draftId: '0199f2a0-0000-7000-8000-0000000000aa' }), creatorId });
    await store.insert(call({ outcome: 'rate_limited', costUsd: 0.000_1, isFallback: true }));
    await store.insert(call({ at: new Date(start.getTime() - 3_600_000), costUsd: 5 }));

    const since = await store.listSince(start);
    expect(since.map((record) => [record.outcome, record.costUsd, record.isFallback])).toEqual([
      ['ok', 0.000_734, false],
      ['rate_limited', 0.000_1, true],
    ]);
    expect(since[0]).toMatchObject({ creatorId, draftId: '0199f2a0-0000-7000-8000-0000000000aa' });
    expect(since[1]).not.toHaveProperty('creatorId');
    const total = since.reduce((sum, record) => sum + (record.costUsd ?? 0), 0);
    expect(total).toBeCloseTo(0.000_834, 9);
  });

  it('gives each call a UUID v7, like every other row (ADR 0011)', async () => {
    await store.insert(call());
    const rows = await test.admin.db.select({ id: schema.llmCalls.id }).from(schema.llmCalls);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.id[14]).toBe('7');
  });
});
