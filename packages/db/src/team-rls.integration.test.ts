import {
  CommissionPresetIdSchema,
  CommissionRateIdSchema,
  MemberRoleIdSchema,
  newId,
  TeamMemberIdSchema,
  TeamMemberNoteIdSchema,
  UserIdSchema,
} from '@nirvana/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withMember } from './client';
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

/** Invented people only (ADR 0010). */
describe('team tables (EQ-01): one policy per account, through withMember', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatterA = newId(UserIdSchema);
  const chatterB = newId(UserIdSchema);
  const memberOf = new Map<string, string>();

  const rateRow = (memberId: string, effectiveFrom: string) => ({
    id: newId(CommissionRateIdSchema),
    memberId,
    rateBps: 2500,
    effectiveFrom,
    createdBy: owner,
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      const people = [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [chatterA, 'operator', 'chatter'],
        [chatterB, 'operator', 'chatter'],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx
          .insert(s.user)
          .values({ id: userId, name: `Compte ${role}`, email: `${userId}@example.test`, role });
        if (teamRole === null) continue;
        const memberId = newId(TeamMemberIdSchema);
        memberOf.set(userId, memberId);
        await tx.insert(s.teamMembers).values({
          id: memberId,
          userId,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: `Membre ${teamRole}`,
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          joinedOn: '2026-10-01',
        });
        await tx.insert(s.memberCommissionRates).values(rateRow(memberId, '2026-10-01'));
        await tx.insert(s.teamMemberNotes).values({
          id: newId(TeamMemberNoteIdSchema),
          memberId,
          body: 'Note interne inventée',
          authorUserId: owner,
        });
      }
    });
  });

  afterAll(async () => {
    await test.close();
  });

  const member = (userId: string) => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };

  it('derives the scope from the database: owner, an active manager, anyone else', async () => {
    expect(await withMember(test.app.db, owner, (_, scope) => Promise.resolve(scope))).toBe('owner');
    expect(await withMember(test.app.db, manager, (_, scope) => Promise.resolve(scope))).toBe('agency');
    expect(await withMember(test.app.db, chatterA, (_, scope) => Promise.resolve(scope))).toBe('self');
    expect(await withMember(test.app.db, newId(UserIdSchema), (_, scope) => Promise.resolve(scope))).toBe(
      'self',
    );
  });

  it('outside withMember the app role sees no team row, without an error', async () => {
    const rows = await test.app.db.transaction(async (tx) => ({
      members: await tx.select().from(s.teamMembers),
      notes: await tx.select().from(s.teamMemberNotes),
      rates: await tx.select().from(s.memberCommissionRates),
    }));
    expect(rows).toEqual({ members: [], notes: [], rates: [] });
  });

  it('a chatter reads his own card and rate, never another one, nor the notes on his own card', async () => {
    const seen = await withMember(test.app.db, chatterA, async (tx) => ({
      members: await tx.select({ userId: s.teamMembers.userId }).from(s.teamMembers),
      rates: await tx.select({ memberId: s.memberCommissionRates.memberId }).from(s.memberCommissionRates),
      notes: await tx.select().from(s.teamMemberNotes),
      presets: await tx.select().from(s.commissionPresets),
    }));
    expect(seen.members).toEqual([{ userId: chatterA }]);
    expect(seen.rates).toEqual([{ memberId: member(chatterA) }]);
    expect(seen.notes).toEqual([]);
    expect(seen.presets).toEqual([]);
  });

  it('an active manager reads the whole team and writes notes, but not the notes on his own card, nor a rate or a preset', async () => {
    const seen = await withMember(test.app.db, manager, async (tx) => ({
      members: (await tx.select().from(s.teamMembers)).length,
      rates: (await tx.select().from(s.memberCommissionRates)).length,
      notes: (await tx.select({ memberId: s.teamMemberNotes.memberId }).from(s.teamMemberNotes)).map(
        (row) => row.memberId,
      ),
    }));
    expect(seen.members).toBe(3);
    expect(seen.rates).toBe(3);
    expect(seen.notes.sort()).toEqual([member(chatterA), member(chatterB)].sort());
    await withMember(test.app.db, manager, (tx) =>
      tx.insert(s.teamMemberNotes).values({
        id: newId(TeamMemberNoteIdSchema),
        memberId: member(chatterB),
        body: 'Ponctuel cette semaine',
        authorUserId: manager,
      }),
    );
    expect(
      await failure(
        withMember(test.app.db, manager, (tx) =>
          tx
            .insert(s.memberCommissionRates)
            .values({ ...rateRow(member(chatterA), '2026-11-01'), createdBy: manager }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await failure(
        withMember(test.app.db, manager, (tx) =>
          tx.insert(s.commissionPresets).values({
            id: newId(CommissionPresetIdSchema),
            name: 'Standard',
            rateBps: 3000,
            effectiveFrom: '2026-11-01',
            createdBy: manager,
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await failure(
        withMember(test.app.db, manager, (tx) =>
          tx
            .update(s.teamMembers)
            .set({ status: 'left' })
            .where(eq(s.teamMembers.userId, chatterA))
            .returning(),
        ).then((rows) => (rows.length === 0 ? Promise.reject(new Error('nothing updated')) : rows)),
      ),
    ).toMatch(/nothing updated/);
  });

  it('a chatter writes no note, and nobody signs a note for someone else', async () => {
    expect(
      await failure(
        withMember(test.app.db, chatterA, (tx) =>
          tx.insert(s.teamMemberNotes).values({
            id: newId(TeamMemberNoteIdSchema),
            memberId: member(chatterB),
            body: 'Essai',
            authorUserId: chatterA,
          }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(
      await failure(
        withMember(test.app.db, manager, (tx) =>
          tx.insert(s.teamMemberNotes).values({
            id: newId(TeamMemberNoteIdSchema),
            memberId: member(chatterB),
            body: 'Essai',
            authorUserId: owner,
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it('the owner alone sets a rate and a preset, signed by his own account, and neither is ever changed nor removed', async () => {
    const presetId = newId(CommissionPresetIdSchema);
    await withMember(test.app.db, owner, async (tx) => {
      await tx.insert(s.commissionPresets).values({
        id: presetId,
        name: 'Standard',
        rateBps: 3000,
        effectiveFrom: '2026-11-01',
        createdBy: owner,
      });
      await tx
        .insert(s.memberCommissionRates)
        .values({ ...rateRow(member(chatterA), '2026-11-01'), presetId });
    });
    for (const change of [
      () => withMember(test.app.db, owner, (tx) => tx.update(s.memberCommissionRates).set({ rateBps: 9000 })),
      () => withMember(test.app.db, owner, (tx) => tx.delete(s.memberCommissionRates)),
      () => withMember(test.app.db, owner, (tx) => tx.update(s.commissionPresets).set({ rateBps: 9000 })),
      () => withMember(test.app.db, owner, (tx) => tx.delete(s.teamMemberNotes)),
      () => withMember(test.app.db, owner, (tx) => tx.delete(s.teamMembers)),
    ]) {
      expect(await failure(change())).toMatch(/permission denied/);
    }
    expect(
      await failure(
        withMember(test.app.db, owner, (tx) =>
          tx
            .insert(s.memberCommissionRates)
            .values({ ...rateRow(member(chatterB), '2026-11-01'), createdBy: manager }),
        ),
      ),
    ).toMatch(/row-level security/);
    expect(await failure(withAdmin(test.admin.db, (tx) => tx.delete(s.memberCommissionRates)))).toMatch(
      /append-only/,
    );
  });

  it('dated roles: the owner alone adds one, a chatter reads his own, a manager everyone’s, nobody changes one', async () => {
    const roleRow = (userId: string, effectiveFrom: string, createdBy: string = owner) => ({
      id: newId(MemberRoleIdSchema),
      memberId: member(userId),
      teamRole: 'manager',
      effectiveFrom,
      createdBy,
    });
    await withMember(test.app.db, owner, (tx) =>
      tx.insert(s.memberRoles).values([roleRow(chatterA, '2026-11-16'), roleRow(chatterB, '2026-11-16')]),
    );
    const readBy = (userId: string) =>
      withMember(test.app.db, userId, async (tx) =>
        (await tx.select({ memberId: s.memberRoles.memberId }).from(s.memberRoles)).map(
          (row) => row.memberId,
        ),
      );
    expect(await readBy(chatterA)).toEqual([member(chatterA)]);
    expect(await readBy(manager)).toHaveLength(2);
    for (const [userId, row] of [
      [manager, roleRow(chatterA, '2026-12-01', manager)],
      [chatterA, roleRow(chatterA, '2026-12-01', chatterA)],
      [owner, roleRow(chatterA, '2026-12-01', manager)],
    ] as const) {
      expect(
        await failure(withMember(test.app.db, userId, (tx) => tx.insert(s.memberRoles).values(row))),
      ).toMatch(/row-level security/);
    }
    expect(
      await failure(
        withMember(test.app.db, owner, (tx) => tx.update(s.memberRoles).set({ teamRole: 'chatter' })),
      ),
    ).toMatch(/permission denied/);
    expect(await failure(withAdmin(test.admin.db, (tx) => tx.delete(s.memberRoles)))).toMatch(/append-only/);
  });

  it('a manager who is no longer active falls back to his own rows', async () => {
    await withMember(test.app.db, owner, (tx) =>
      tx.update(s.teamMembers).set({ status: 'suspended' }).where(eq(s.teamMembers.userId, manager)),
    );
    const seen = await withMember(test.app.db, manager, async (tx, scope) => ({
      scope,
      members: await tx.select({ userId: s.teamMembers.userId }).from(s.teamMembers),
      notes: (await tx.select().from(s.teamMemberNotes)).length,
    }));
    expect(seen).toEqual({ scope: 'self', members: [{ userId: manager }], notes: 0 });
    await withMember(test.app.db, owner, (tx) =>
      tx.update(s.teamMembers).set({ status: 'active' }).where(eq(s.teamMembers.userId, manager)),
    );
  });

  it('the scope does not leak to the next transaction on the same pool', async () => {
    await withMember(test.app.db, owner, () => Promise.resolve());
    const [setting] = (
      await test.app.db.execute<{ scope: string | null; user: string | null }>(
        sql`select nullif(current_setting('app.team_scope', true), '') as scope, nullif(current_setting('app.user_id', true), '') as user`,
      )
    ).rows;
    expect(setting).toEqual({ scope: null, user: null });
  });
});
