import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import type { BudgetEvent } from '@impera/llm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { publishBudgetThreshold } from '../budget-events';
import { createJobQueue, type JobQueue } from '../jobs';

const crossing = (kind: BudgetEvent['kind']): BudgetEvent => ({
  kind,
  status: { day: '2026-10-17', spentEur: 16.004, capEur: 20, alertAtEur: 16, state: kind },
});

describe('budget_threshold_crossed in the outbox', () => {
  let test: TestDb;
  let queue: JobQueue;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // Graphile's schema, so that a trigger left behind would have somewhere to enqueue.
    queue = await createJobQueue(test.admin.pool);
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  it('writes one row per day and kind, without a creator, however many processes see it', async () => {
    await Promise.all([
      publishBudgetThreshold(test.service.db, crossing('alert')),
      publishBudgetThreshold(test.service.db, crossing('alert')),
    ]);
    await publishBudgetThreshold(test.service.db, crossing('reached'));

    const rows = await test.admin.db
      .select({ creatorId: schema.domainEvents.creatorId, payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'budget_threshold_crossed'))
      .orderBy(schema.domainEvents.createdAt);
    expect(rows).toEqual([
      {
        creatorId: null,
        payload: { kind: 'alert', spentMinor: 1600, capMinor: 2000, currency: 'EUR', day: '2026-10-17' },
      },
      {
        creatorId: null,
        payload: { kind: 'reached', spentMinor: 1600, capMinor: 2000, currency: 'EUR', day: '2026-10-17' },
      },
    ]);
    // No Telegram scan any more (ADR 0176): its trigger is gone, nothing waits for the agency's events.
    const scans = await test.admin.db.execute(
      sql`select count(*)::int as n from graphile_worker.jobs where task_identifier = 'telegram.scan'`,
    );
    expect(scans.rows).toEqual([{ n: 0 }]);
  });
});
