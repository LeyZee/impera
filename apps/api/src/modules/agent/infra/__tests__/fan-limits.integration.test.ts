import { CreatorIdSchema, FanIdSchema, newId, PlatformAccountIdSchema } from '@nirvana/contracts';
import { and, eq, schema, withAdmin } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createFansModule } from '../../../fans';
import { protectionFor } from '../../domain/hold';
import { createFanLimits, type FanLimits } from '../fan-limits';

describe('fan limits set by the policy, through the fans module', () => {
  let test: TestDb;
  let limits: FanLimits;
  const creatorId = newId(CreatorIdSchema);
  const fanId = newId(FanIdSchema);
  const brokeFanId = newId(FanIdSchema);
  const frozenFanId = newId(FanIdSchema);
  const AT = new Date('2026-10-17T20:00:00.000Z');

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    limits = createFanLimits(createFansModule({ db: test.app.db, adminDb: test.admin.db }));
    // One invented creator and fan (ADR 0010), already confirmed an adult.
    const accountId = newId(PlatformAccountIdSchema);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.creators)
        .values({ id: creatorId, nameKey: creatorId, displayName: 'Anna', timezone: 'Europe/Paris' });
      await tx
        .insert(schema.platformAccounts)
        .values({ id: accountId, creatorId, platform: 'reveal', handle: 'anna-demo' });
      await tx.insert(schema.fans).values({
        id: fanId,
        creatorId,
        platformAccountId: accountId,
        platformFanId: 'fan-1',
        displayName: 'Basile',
        flags: { ageConfirmedAt: '2026-10-01T09:00:00.000Z' },
      });
      // Two more: one who will say he cannot pay, one a human already froze.
      await tx.insert(schema.fans).values([
        {
          id: brokeFanId,
          creatorId,
          platformAccountId: accountId,
          platformFanId: 'fan-2',
          displayName: 'Théo',
          flags: { ageConfirmedAt: '2026-10-01T09:00:00.000Z' },
        },
        {
          id: frozenFanId,
          creatorId,
          platformAccountId: accountId,
          platformFanId: 'fan-3',
          displayName: 'Hugo',
          flags: { salesFrozen: { reason: 'operator', since: '2026-10-10T09:00:00.000Z' } },
        },
      ]);
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('stops contact and takes back his age, authored by the system, once', async () => {
    const protection = protectionFor(['possible_minor', 'distress']);
    await limits.protect(creatorId, fanId, protection, 'correlation-1', AT);
    // A replayed job changes nothing more.
    await limits.protect(creatorId, fanId, protection, 'correlation-1', AT);
    expect(await limits.flags(creatorId, fanId)).toMatchObject({
      doNotContact: true,
      ageDisputed: { by: 'policy' },
    });
    expect((await limits.flags(creatorId, fanId)).ageConfirmedAt).toBeUndefined();
    const events = await test.admin.db
      .select()
      .from(schema.domainEvents)
      .where(
        and(
          eq(schema.domainEvents.creatorId, creatorId),
          eq(schema.domainEvents.correlationId, 'correlation-1'),
        ),
      );
    expect(events.map((event) => [event.type, event.actor]).sort()).toEqual([
      ['fan_flag_cleared', 'system'],
      ['fan_flag_set', 'system'],
    ]);
    expect(events[0]?.payload).toMatchObject({ reason: 'possible_minor, distress' });
  });

  it('freezes his sales when he says he cannot pay, dated, and keeps a freeze a human set', async () => {
    const money = protectionFor(['money_trouble']);
    await limits.protect(creatorId, brokeFanId, money, 'correlation-2', AT);
    await limits.protect(creatorId, brokeFanId, money, 'correlation-2', AT);
    expect(await limits.flags(creatorId, brokeFanId)).toEqual({
      ageConfirmedAt: '2026-10-01T09:00:00.000Z',
      salesFrozen: { reason: 'money_trouble', since: AT.toISOString() },
    });
    await limits.protect(creatorId, frozenFanId, money, 'correlation-3', AT);
    expect((await limits.flags(creatorId, frozenFanId)).salesFrozen?.reason).toBe('operator');
  });

  it('confirms his age when he stated it, once, and keeps a confirmation already there', async () => {
    await limits.confirmAge(creatorId, frozenFanId, 'correlation-6', AT);
    await limits.confirmAge(creatorId, frozenFanId, 'correlation-6', new Date('2026-10-18T08:00:00.000Z'));
    expect((await limits.flags(creatorId, frozenFanId)).ageConfirmedAt).toBe(AT.toISOString());
  });

  it('never confirms again an age taken back, by a sign of a minor or by a human, until a human decides', async () => {
    const fans = createFansModule({ db: test.app.db, adminDb: test.admin.db });
    // Taken back by the policy (fan-1, a sign of a minor above): « j'ai 19 ans » next does not confirm it.
    await limits.confirmAge(creatorId, fanId, 'correlation-7', AT);
    expect((await limits.flags(creatorId, fanId)).ageConfirmedAt).toBeUndefined();
    // Taken back by a human from Suivi.
    await fans.clearFlag(creatorId, frozenFanId, 'ageConfirmedAt', {
      author: 'human:owner',
      correlationId: 'correlation-8',
    });
    await limits.confirmAge(creatorId, frozenFanId, 'correlation-9', AT);
    expect(await limits.flags(creatorId, frozenFanId)).toMatchObject({ ageDisputed: { by: 'human' } });
    expect((await limits.flags(creatorId, frozenFanId)).ageConfirmedAt).toBeUndefined();
    // The owner confirms it again, saying why: that settles the dispute (SUIVI-04: an owner or a manager only).
    await test.admin.db
      .insert(schema.user)
      .values({ id: 'owner-fan-limits', name: 'Owner', email: 'owner@example.test', role: 'owner' });
    await fans.setFlag(
      creatorId,
      frozenFanId,
      { flag: 'ageConfirmedAt', value: AT.toISOString() },
      { author: 'human:owner-fan-limits', reason: 'Vérifié en appel', correlationId: 'correlation-10' },
    );
    const settled = await limits.flags(creatorId, frozenFanId);
    expect(settled.ageConfirmedAt).toBe(AT.toISOString());
    expect(settled.ageDisputed).toBeUndefined();
  });
});
