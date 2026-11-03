import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  KillSwitchIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type TeamMemberStatus,
} from '@impera/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withMember, type Transaction } from './client';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

/** The Postgres message behind a failed query (Drizzle wraps it as `cause`). */
async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    return cause instanceof Error ? cause.message : String(cause);
  }
  return 'no error';
}

/**
 * The calendar's one door (CR-12, ADR 0045 § 1, ADR 0048 § 3): `calendar_shifts` and `calendar_agent` apply the
 * boundary themselves, from the account of the transaction. Invented people and creators only (ADR 0010).
 */
describe('the shift calendar (CR-12): who reads which shifts, and the agent', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatterA = newId(UserIdSchema);
  const chatterB = newId(UserIdSchema);
  const loner = newId(UserIdSchema); // an operator without a member row
  const creatorUser = newId(UserIdSchema);
  const stranger = newId(UserIdSchema); // no account at all
  const memberOf = new Map<string, string>();
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const ines = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const FROM = '2099-11-02T00:00:00Z';
  const TO = '2099-11-09T00:00:00Z';

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  const shiftRow = (
    creator: { creatorId: string; accountId: string },
    userId: string,
    startsAt: string,
    endsAt: string,
  ) => ({
    id: newId(ShiftIdSchema),
    creatorId: creator.creatorId,
    platformAccountId: creator.accountId,
    memberId: member(userId),
    startsAt: new Date(startsAt),
    endsAt: new Date(endsAt),
    createdBy: owner,
    updatedBy: owner,
  });

  interface Row {
    readonly member_id: string;
    readonly member_name: string;
    readonly member_color: string | null;
    readonly creator_id: string;
    readonly starts_at: string | Date;
    readonly ends_at: string | Date;
  }

  /** What `userId` reads of the calendar, in `creatorId` when one is set (a creator's reading path). */
  const shiftsOf = async (
    userId: string,
    creatorId: string | null = null,
    from = FROM,
    to = TO,
  ): Promise<Row[]> =>
    withMember(test.app.db, userId, async (tx: Transaction) => {
      if (creatorId !== null) await tx.execute(sql`select set_config('app.creator_id', ${creatorId}, true)`);
      const result = await tx.execute<Row & Record<string, unknown>>(
        sql`select * from calendar_shifts(${from}::timestamptz, ${to}::timestamptz)`,
      );
      return result.rows;
    });

  const memberIds = (rows: readonly Row[]): string[] => rows.map((row) => row.member_id);
  const creatorIds = (rows: readonly Row[]): string[] =>
    [...new Set(rows.map((row) => row.creator_id))].toSorted();

  const agentOf = async (userId: string, creatorId: string | null = null) =>
    withMember(test.app.db, userId, async (tx: Transaction) => {
      if (creatorId !== null) await tx.execute(sql`select set_config('app.creator_id', ${creatorId}, true)`);
      const result = await tx.execute<{
        creator_id: string;
        time_zone: string;
        mode: string;
        reply: unknown;
      }>(sql`select * from calendar_agent()`);
      return result.rows;
    });

  const setStatus = (userId: string, status: TeamMemberStatus) =>
    withAdmin(test.admin.db, (tx) =>
      tx
        .update(s.teamMembers)
        .set({ status, leftOn: status === 'left' ? '2099-10-31' : null })
        .where(eq(s.teamMembers.userId, userId)),
    );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [label, creator] of [
        ['Nora', nora],
        ['Inès', ines],
      ] as const) {
        await tx.insert(s.creators).values({
          id: creator.creatorId,
          nameKey: creator.creatorId,
          displayName: `Créatrice ${label}`,
          timezone: 'Europe/Paris',
        });
        await tx.insert(s.platformAccounts).values({
          id: creator.accountId,
          creatorId: creator.creatorId,
          platform: 'reveal',
          handle: `handle-${label}`,
        });
      }
      await tx
        .update(s.creators)
        .set({
          agentHours: {
            reply: { mode: 'slots', slots: [{ day: 1, startMinute: 540, endMinute: 60, enabled: true }] },
            followUpQuiet: { startMinute: 1380, endMinute: 540 },
            night: { startMinute: 1320, endMinute: 420 },
          },
        })
        .where(eq(s.creators.id, nora.creatorId));
      const people = [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [chatterA, 'operator', 'chatter'],
        [chatterB, 'operator', 'chatter'],
        [loner, 'operator', null],
        [creatorUser, 'creator', null],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx.insert(s.user).values({
          id: userId,
          name: `Compte ${role}`,
          email: `${userId}@example.test`,
          role,
          creatorIds: role === 'creator' ? [nora.creatorId] : [],
        });
        if (teamRole === null) continue;
        const memberId = newId(TeamMemberIdSchema);
        memberOf.set(userId, memberId);
        await tx.insert(s.teamMembers).values({
          id: memberId,
          userId,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: userId === chatterA ? 'Kofi' : userId === chatterB ? 'Ama' : 'Iris',
          color: userId === chatterA ? '#5b8def' : null,
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          joinedOn: '2099-10-01',
        });
      }
      const cancelled = shiftRow(nora, chatterB, '2099-11-04T00:00:00Z', '2099-11-04T06:00:00Z');
      await tx.insert(s.shifts).values([
        shiftRow(nora, chatterA, '2099-11-02T00:00:00Z', '2099-11-02T06:00:00Z'),
        shiftRow(nora, chatterB, '2099-11-02T06:00:00Z', '2099-11-02T12:00:00Z'),
        shiftRow(ines, chatterB, '2099-11-03T00:00:00Z', '2099-11-03T06:00:00Z'),
        shiftRow(ines, manager, '2099-11-03T06:00:00Z', '2099-11-03T12:00:00Z'),
        // Outside the week: never read.
        shiftRow(nora, chatterA, '2099-11-20T00:00:00Z', '2099-11-20T06:00:00Z'),
        { ...cancelled, cancelledAt: new Date('2099-11-01T00:00:00Z') },
      ]);
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('gives the owner and an active manager every shift of the week, never a cancelled one', async () => {
    for (const reader of [owner, manager]) {
      const rows = await shiftsOf(reader);
      expect(rows).toHaveLength(4);
      expect(creatorIds(rows)).toEqual([nora.creatorId, ines.creatorId].toSorted());
    }
  });

  it('gives an active chatter the whole team, on every creator, in six columns and nothing more', async () => {
    const rows = await shiftsOf(chatterA);
    expect(memberIds(rows).toSorted()).toEqual(
      [member(chatterA), member(chatterB), member(chatterB), member(manager)].toSorted(),
    );
    expect(creatorIds(rows)).toEqual([nora.creatorId, ines.creatorId].toSorted());
    const first = rows[0];
    expect(Object.keys(first ?? {}).toSorted()).toEqual(
      ['creator_id', 'ends_at', 'member_color', 'member_id', 'member_name', 'starts_at'].toSorted(),
    );
    expect(rows.find((row) => row.member_id === member(chatterA))).toMatchObject({
      member_name: 'Kofi',
      member_color: '#5b8def',
    });
  });

  it.each(['on_leave', 'sick', 'travelling', 'suspended', 'left'] as const)(
    'gives a chatter %s his own shifts only',
    async (status) => {
      await setStatus(chatterB, status);
      try {
        expect(memberIds(await shiftsOf(chatterB))).toEqual([member(chatterB), member(chatterB)]);
      } finally {
        await setStatus(chatterB, 'active');
      }
    },
  );

  it('keeps the name of a member who left on his shifts, for the agency', async () => {
    await setStatus(chatterB, 'left');
    try {
      const theirs = (await shiftsOf(owner)).filter((row) => row.member_id === member(chatterB));
      expect(theirs.map((row) => row.member_name)).toEqual(['Ama', 'Ama']);
    } finally {
      await setStatus(chatterB, 'active');
    }
  });

  it('gives a manager who is not active his own shifts only', async () => {
    await setStatus(manager, 'on_leave');
    try {
      expect(memberIds(await shiftsOf(manager))).toEqual([member(manager)]);
    } finally {
      await setStatus(manager, 'active');
    }
  });

  it('gives a creator the shifts of her own creator only, and nothing outside her creators', async () => {
    const hers = await shiftsOf(creatorUser, nora.creatorId);
    expect(creatorIds(hers)).toEqual([nora.creatorId]);
    expect(hers).toHaveLength(2);
    // Another creator's id set on her transaction, or none: nothing.
    expect(await shiftsOf(creatorUser, ines.creatorId)).toEqual([]);
    expect(await shiftsOf(creatorUser)).toEqual([]);
  });

  it('gives nothing to an unknown account, nor to an operator without a member row', async () => {
    expect(await shiftsOf(stranger)).toEqual([]);
    expect(await shiftsOf(loner)).toEqual([]);
    // Outside any account: nothing either.
    const outside = await test.app.db.execute(
      sql`select * from calendar_shifts(${FROM}::timestamptz, ${TO}::timestamptz)`,
    );
    expect(outside.rows).toEqual([]);
  });

  it('refuses a window longer than 6 weeks, or an empty one', async () => {
    expect(await failure(shiftsOf(owner, null, FROM, '2099-12-15T00:00:00Z'))).toMatch(/at most 6 weeks/u);
    expect(await failure(shiftsOf(owner, null, FROM, FROM))).toMatch(/at most 6 weeks/u);
    // Exactly 6 weeks: a month view.
    expect(await shiftsOf(owner, null, FROM, '2099-12-14T00:00:00Z')).toHaveLength(5);
  });

  it('leaves the shifts and the team closed to a chatter outside the function', async () => {
    const seen = await withMember(test.app.db, chatterA, async (tx) => ({
      members: await tx.select({ id: s.teamMembers.id }).from(s.teamMembers),
      leaves: await tx.select({ id: s.leaveRequests.id }).from(s.leaveRequests),
    }));
    expect(seen.members.map((row) => row.id)).toEqual([member(chatterA)]);
    expect(seen.leaves).toEqual([]);
  });

  it('cannot be called from the application role but through its two readers', async () => {
    const scope = await failure(test.app.db.execute(sql`select calendar_reader_scope()`));
    expect(scope).toMatch(/permission denied/u);
  });

  describe('the agent (ADR 0048)', () => {
    it('gives the owner, an active manager and an active chatter each creator’s clock, mode and reply hours', async () => {
      for (const reader of [owner, manager, chatterA]) {
        const rows = await agentOf(reader);
        expect(rows.map((row) => row.creator_id).toSorted()).toEqual(
          [nora.creatorId, ines.creatorId].toSorted(),
        );
        const hers = rows.find((row) => row.creator_id === nora.creatorId);
        expect(hers).toMatchObject({ time_zone: 'Europe/Paris', mode: 'copilot' });
        expect(hers?.reply).toEqual({
          mode: 'slots',
          slots: [{ day: 1, startMinute: 540, endMinute: 60, enabled: true }],
        });
        expect(Object.keys(hers ?? {}).toSorted()).toEqual(['creator_id', 'mode', 'reply', 'time_zone']);
        // Without a setting: always.
        expect(rows.find((row) => row.creator_id === ines.creatorId)?.reply).toEqual({ mode: 'always' });
      }
    });

    it('gives nothing to a member restricted to his own shifts, to a creator, nor to anyone else', async () => {
      await setStatus(chatterB, 'sick');
      try {
        expect(await agentOf(chatterB)).toEqual([]);
      } finally {
        await setStatus(chatterB, 'active');
      }
      expect(await agentOf(creatorUser, nora.creatorId)).toEqual([]);
      expect(await agentOf(stranger)).toEqual([]);
      expect(await agentOf(loner)).toEqual([]);
    });

    it('says Automatique while one of her conversations runs alone, and Arrêt under her stop or the global one', async () => {
      const fanId = newId(FanIdSchema);
      await withAdmin(test.admin.db, async (tx) => {
        await tx.insert(s.fans).values({
          id: fanId,
          creatorId: nora.creatorId,
          platformAccountId: nora.accountId,
          platformFanId: 'fan-invente',
          displayName: 'Fan inventé',
        });
        await tx.insert(s.conversations).values({
          id: newId(ConversationIdSchema),
          creatorId: nora.creatorId,
          platformAccountId: nora.accountId,
          fanId,
          platformConversationId: 'conv-inventee',
          mode: 'auto',
        });
      });
      const modes = async () =>
        Object.fromEntries((await agentOf(chatterA)).map((row) => [row.creator_id, row.mode]));
      expect(await modes()).toEqual({ [nora.creatorId]: 'auto', [ines.creatorId]: 'copilot' });

      await withAdmin(test.admin.db, (tx) =>
        tx.insert(s.killSwitches).values({
          id: newId(KillSwitchIdSchema),
          scope: 'creator',
          scopeId: nora.creatorId,
          creatorId: nora.creatorId,
          active: true,
          reason: 'essai',
          setBy: owner,
        }),
      );
      expect(await modes()).toEqual({ [nora.creatorId]: 'stop', [ines.creatorId]: 'copilot' });

      // The latest row wins: lifted, then the global stop.
      await withAdmin(test.admin.db, async (tx) => {
        await tx.insert(s.killSwitches).values({
          id: newId(KillSwitchIdSchema),
          scope: 'creator',
          scopeId: nora.creatorId,
          creatorId: nora.creatorId,
          active: false,
          reason: 'essai',
          setBy: owner,
          setAt: new Date(Date.now() + 1_000),
        });
        await tx.insert(s.killSwitches).values({
          id: newId(KillSwitchIdSchema),
          scope: 'global',
          active: true,
          reason: 'essai',
          setBy: owner,
        });
      });
      expect(await modes()).toEqual({ [nora.creatorId]: 'stop', [ines.creatorId]: 'stop' });
    });
  });
});
