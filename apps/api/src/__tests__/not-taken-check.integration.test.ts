import {
  CreatorIdSchema,
  EVENT_PAYLOADS,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createDrizzleNotTakenCheck } from '../modules/scheduling/infra/not-taken-check';

/**
 * « Chatteur pas là » (ADR 0094 § 1, lot b) on a real base, through the service role: shifts from 14 h (13:00Z) on
 * Friday 15/01/2027 (ahead of the base's clock: the planning keeps its past, EQ-02), the agency's delay set to 15 minutes in this test only. Everything is invented (ADR 0010): the
 * creators, the members.
 */
describe('chatteur pas là (ADR 0094 § 1, lot b)', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const creators = { nora: newId(CreatorIdSchema), lea: newId(CreatorIdSchema), zoe: newId(CreatorIdSchema) };
  const accounts = {
    nora: newId(PlatformAccountIdSchema),
    lea: newId(PlatformAccountIdSchema),
    zoe: newId(PlatformAccountIdSchema),
  };
  const shifts = {
    kofi: newId(ShiftIdSchema),
    ama: newId(ShiftIdSchema),
    yao: newId(ShiftIdSchema),
    zoe: newId(ShiftIdSchema),
  };

  const notTaken = async () =>
    (
      await test.admin.db
        .select()
        .from(schema.domainEvents)
        .where(eq(schema.domainEvents.type, 'shift_not_taken'))
    ).map((row) => EVENT_PAYLOADS.shift_not_taken.parse(row.payload));

  /** A chatter on `creatorIds`, `status`. */
  const member = async (name: string, creatorIds: string[], status: 'active' | 'on_leave') => {
    const userId = newId(UserIdSchema);
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db
      .insert(schema.user)
      .values({ id: userId, name, email: `${name.toLowerCase()}@example.test`, creatorIds });
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole: 'chatter',
      firstName: name,
      lastName: 'Inventé',
      displayName: name,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-09-01',
      status,
    });
    return memberId;
  };

  const plan = async (
    id: string,
    name: keyof typeof creators,
    memberId: string,
    checkedInAt: Date | null = null,
  ) => {
    await test.admin.db.insert(schema.shifts).values({
      id,
      creatorId: creators[name],
      platformAccountId: accounts[name],
      memberId,
      startsAt: new Date('2027-01-15T13:00:00Z'),
      endsAt: new Date('2027-01-15T19:00:00Z'),
      createdBy: owner,
      updatedBy: owner,
    });
    // The base clears a check-in written with the shift (0247): it is dated afterwards, as the member's gesture does.
    if (checkedInAt !== null) {
      await test.admin.db.update(schema.shifts).set({ checkedInAt }).where(eq(schema.shifts.id, id));
    }
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await test.admin.db
      .insert(schema.user)
      .values({ id: owner, name: 'Propriétaire', email: 'owner@example.test' });
    for (const name of ['nora', 'lea', 'zoe'] as const) {
      await test.admin.db.insert(schema.creators).values({
        id: creators[name],
        nameKey: `creatrice_${name}`,
        displayName: `Créatrice ${name}`,
        timezone: 'Europe/Paris',
        archivedAt: name === 'zoe' ? new Date('2026-11-01T00:00:00Z') : null,
      });
      await test.admin.db.insert(schema.platformAccounts).values({
        id: accounts[name],
        creatorId: creators[name],
        platform: 'reveal',
        handle: `creatrice_${name}`,
      });
    }
    // Kofi has not taken Nora's shift; Ama took Léa's at 14 h 05; Yao is on leave; Zoé is archived.
    await plan(shifts.kofi, 'nora', await member('Kofi', [creators.nora], 'active'));
    await plan(
      shifts.ama,
      'lea',
      await member('Ama', [creators.lea], 'active'),
      new Date('2027-01-15T13:05:00Z'),
    );
    await plan(shifts.yao, 'lea', await member('Yao', [creators.lea], 'on_leave'));
    await plan(shifts.zoe, 'zoe', await member('Zoé', [creators.zoe], 'active'));
  });

  afterAll(async () => {
    await test.close();
  });

  it('publishes nothing while the agency has set no delay', async () => {
    const check = createDrizzleNotTakenCheck(test.service.db);
    expect(await check.run(new Date('2027-01-15T13:20:00Z'), 'job:test')).toBe(0);
    await test.admin.db.insert(schema.schedulingSettings).values({
      id: 1,
      timeZone: 'Europe/Paris',
      slotStartMinute: 0,
      slotLengthMinutes: 360,
      accessMarginMinutes: 15,
      updatedBy: owner,
    });
    expect(await check.run(new Date('2027-01-15T13:20:00Z'), 'job:test')).toBe(0);
    expect(await notTaken()).toEqual([]);
  });

  it('publishes once the shift held and not taken, the delay past', async () => {
    await test.admin.db.update(schema.schedulingSettings).set({ notTakenDelayMinutes: 15 });
    const check = createDrizzleNotTakenCheck(test.service.db);
    expect(await check.run(new Date('2027-01-15T13:14:00Z'), 'job:test')).toBe(0);
    expect(await check.run(new Date('2027-01-15T13:16:00Z'), 'job:test')).toBe(1);
    // Five minutes later the same shift is seen again and published no more.
    expect(await check.run(new Date('2027-01-15T13:21:00Z'), 'job:test')).toBe(0);
    const events = await notTaken();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      creatorId: creators.nora,
      platform: 'reveal',
      platformAccountId: accounts.nora,
      shiftId: shifts.kofi,
      memberName: 'Kofi',
      startsAt: '2027-01-15T13:00:00.000Z',
      endsAt: '2027-01-15T19:00:00.000Z',
      timeZone: 'Europe/Paris',
    });
  });

  it('refuses a delay outside its bounds, and a stored choice that opens it to the chatters', async () => {
    await expect(
      test.admin.db.update(schema.schedulingSettings).set({ notTakenDelayMinutes: 2 }),
    ).rejects.toThrow();
    await expect(
      test.admin.db.insert(schema.creatorAlertRoutes).values({
        creatorId: creators.nora,
        alertCode: 'shift_not_taken',
        role: 'chatter_on_shift',
        mode: 'muted',
      }),
    ).rejects.toThrow();
  });
});
