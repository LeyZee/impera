import { CreatorIdSchema, DesireMarkIdSchema, newId, type CreatorId } from '@impera/contracts';
import { schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDbDesireMarkStore, type DesireMarkRecord } from '../modules/playground';

const OWNER = 'desire-marks-owner';
const T0 = new Date('2026-11-12T20:00:00.000Z');

function mark(creatorId: CreatorId, n: number, minutes: number): DesireMarkRecord {
  return {
    id: newId(DesireMarkIdSchema),
    creatorId,
    fanMessageNumber: n,
    fanMessage: `message ${String(n)}`,
    verdict: n % 2 === 0 ? 'too_high' : 'right',
    note: n % 2 === 0 ? 'il parle de son travail' : null,
    reading: { before: 20, score: 34, signals: ['states_desire', 'long_reply'] },
    weightsVersion: 'desire-1',
    markedBy: OWNER,
    markedAt: new Date(T0.getTime() + minutes * 60_000),
  };
}

describe('desire marks in the database (ADR 0103 § 6)', () => {
  let test: TestDb;
  let nora: CreatorId;
  let lina: CreatorId;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    nora = newId(CreatorIdSchema);
    lina = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: nora, displayName: 'Nora Vidal', timezone: 'Europe/Paris' },
      { id: lina, nameKey: lina, displayName: 'Lina Morel', timezone: 'Europe/Paris' },
    ]);
    await test.admin.db.insert(schema.user).values({ id: OWNER, name: 'Owner', email: 'owner@example.test' });
  });

  afterAll(async () => {
    await test.close();
  });

  it('keeps the counting as it was, gives hers newest first, and never another creator’s', async () => {
    const store = createDbDesireMarkStore(test.app.db);
    const first = mark(nora, 1, 0);
    const second = mark(nora, 2, 5);
    await store.add(first);
    await store.add(second);
    await store.add(mark(lina, 1, 10));

    const hers = await store.list(nora, 500);
    expect(hers.map((m) => m.id)).toEqual([second.id, first.id]);
    expect(hers[0]).toEqual(second);
    expect(hers[1]?.note).toBeNull();

    expect(await store.list(nora, 1)).toHaveLength(1);
    expect((await store.list(lina, 500)).map((m) => m.creatorId)).toEqual([lina]);
  });
});
