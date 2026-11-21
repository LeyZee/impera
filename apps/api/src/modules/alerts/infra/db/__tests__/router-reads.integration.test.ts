import { CreatorIdSchema, EventIdSchema, newId, TeamMemberIdSchema } from '@impera/contracts';
import { schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createRouterReads } from '../router-reads';

const CONVERSATION = '01900000-0000-7000-8000-000000000020';

describe('the reads of alerts.route (ADR 0150 § 18)', () => {
  let test: TestDb;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('reads the safety relays apart, and every event of a burst past one page, the newest included', async () => {
    const creatorId = newId(CreatorIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Test', timezone: 'Europe/Paris' });
    const event = (type: string, payload: object) => ({
      id: newId(EventIdSchema),
      creatorId,
      type,
      payload,
      actor: 'test',
      correlationId: 'test',
    });
    // A burst of 1 200 sales in one instant, then the relays: one for safety, one that is not.
    await test.admin.db
      .insert(schema.domainEvents)
      .values(Array.from({ length: 1_200 }, () => event('sale_detected', {})));
    await test.admin.db
      .insert(schema.domainEvents)
      .values([
        event('handoff_requested', { conversationId: CONVERSATION, cause: 'minor' }),
        event('handoff_requested', { conversationId: CONVERSATION, cause: 'guard' }),
      ]);

    const reads = createRouterReads(test.service.db, () => Promise.resolve('Europe/Paris'));
    const since = new Date(Date.now() - 30 * 60_000);
    const safety = await reads.safetyEvents(since);
    expect(safety.map((row) => row.payload)).toEqual([{ conversationId: CONVERSATION, cause: 'minor' }]);

    const all = await reads.events(since);
    expect(all).toHaveLength(1_202);
    expect(new Set(all.map((row) => row.id)).size).toBe(1_202);
    expect(all.filter((row) => row.type === 'handoff_requested')).toHaveLength(2);
  });

  it('gives each manager the creators of his account, so her alerts reach her managers only (relecture Bilan)', async () => {
    const [nora, iris] = [newId(CreatorIdSchema), newId(CreatorIdSchema)];
    await test.admin.db.insert(schema.creators).values([
      { id: nora, nameKey: nora, displayName: 'Nora', timezone: 'Europe/Paris' },
      { id: iris, nameKey: iris, displayName: 'Iris', timezone: 'Europe/Paris' },
    ]);
    const manager = async (key: string, creatorIds: string[], status: 'active' | 'left' = 'active') => {
      await test.admin.db
        .insert(schema.user)
        .values({ id: key, name: key, email: `${key}@example.test`, creatorIds });
      await test.admin.db.insert(schema.teamMembers).values({
        id: newId(TeamMemberIdSchema),
        userId: key,
        teamRole: 'manager',
        firstName: 'Inventé',
        lastName: 'Inventé',
        displayName: key,
        country: 'FR',
        timeZone: 'Europe/Paris',
        status,
        joinedOn: '2026-10-01',
        ...(status === 'left' && { leftOn: '2026-11-01' }),
      });
    };
    await manager('manager-nora', [nora]);
    await manager('manager-iris', [iris]);
    await manager('manager-gone', [nora], 'left');

    const reads = createRouterReads(test.service.db, () => Promise.resolve('Europe/Paris'));
    const managers = await reads.managers();
    expect(managers.map((m) => [m.userId, m.creatorIds])).toEqual(
      expect.arrayContaining([
        ['manager-nora', [nora]],
        ['manager-iris', [iris]],
      ]),
    );
    expect(managers.map((m) => m.userId)).not.toContain('manager-gone');
  });
});
