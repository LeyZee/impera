import {
  CreatorIdSchema,
  FaultCodeSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type TeamMemberId,
  type UserId,
} from '@impera/contracts';
import { schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { ReviewStore } from '../../application/review';
import { createDrizzleReviewStore } from '../review-store';

/** Invented people, faults and words only (ADR 0010). */
describe('the chatter review store (ADR 0170 §§ 14, 29), as the application role sees it', () => {
  let test: TestDb;
  let store: ReviewStore;
  const nora = newId(CreatorIdSchema);
  const account = newId(PlatformAccountIdSchema);
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatterA = newId(UserIdSchema);
  const chatterB = newId(UserIdSchema);
  const members = new Map<UserId, TeamMemberId>();
  const shiftOfA = newId(ShiftIdSchema);
  const known = FaultCodeSchema.parse('fault.example_known');
  const unknown = FaultCodeSchema.parse('fault.example_unknown');

  const member = (userId: UserId): TeamMemberId => {
    const id = members.get(userId);
    if (id === undefined) throw new Error('no member');
    return id;
  };

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    store = createDrizzleReviewStore(test.app.db);
    await withAdmin(test.admin.db, async (tx) => {
      await tx
        .insert(schema.creators)
        .values({ id: nora, nameKey: nora, displayName: 'Créatrice Nora', timezone: 'Europe/Paris' });
      await tx
        .insert(schema.platformAccounts)
        .values({ id: account, creatorId: nora, platform: 'reveal', handle: 'nora' });
      for (const [userId, role, teamRole] of [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [chatterA, 'operator', 'chatter'],
        [chatterB, 'operator', 'chatter'],
      ] as const) {
        await tx.insert(schema.user).values({
          id: userId,
          name: `Compte ${role}`,
          email: `${userId}@example.test`,
          role,
          creatorIds: role === 'owner' ? [] : [nora],
        });
        if (teamRole === null) continue;
        const id = newId(TeamMemberIdSchema);
        members.set(userId, id);
        await tx.insert(schema.teamMembers).values({
          id,
          userId,
          teamRole,
          firstName: 'Prénom',
          lastName: 'Inventé',
          displayName: `Membre ${teamRole}`,
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          joinedOn: '2026-10-01',
        });
      }
      const startsAt = new Date('2026-11-26T17:00:00Z');
      await tx.insert(schema.shifts).values({
        id: shiftOfA,
        creatorId: nora,
        platformAccountId: account,
        memberId: member(chatterA),
        startsAt,
        endsAt: new Date(startsAt.getTime() + 6 * 3_600_000),
        createdBy: owner,
        updatedBy: owner,
      });
      await tx
        .insert(schema.chatterFaultLevels)
        .values({ faultCode: known, level: 'standard', label: 'Une faute inventée', updatedBy: owner });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('knows a shift as his own only', async () => {
    expect(await store.shiftMember(nora, chatterA, shiftOfA)).toBe(member(chatterA));
    expect(await store.shiftMember(nora, chatterB, shiftOfA)).toBeNull();
    expect(await store.memberOf(nora, owner)).toBeNull();
  });

  it('records an explanation once, only for a fault the owner has saved', async () => {
    const first = crypto.randomUUID();
    await store.recordExplanations(nora, chatterA, member(chatterA), [
      { faultCode: known, remarkId: first },
      { faultCode: unknown, remarkId: crypto.randomUUID() },
    ]);
    const firstRead = await store.explanations(nora, chatterA, member(chatterA), [known, unknown]);
    expect([...firstRead.keys()]).toEqual([known]);
    await store.recordExplanations(nora, chatterA, member(chatterA), [
      { faultCode: known, remarkId: crypto.randomUUID() },
    ]);
    const again = await store.explanations(nora, chatterA, member(chatterA), [known]);
    expect(again.get(known)).toEqual(firstRead.get(known));
    expect(await store.explanations(nora, chatterB, member(chatterA), [known])).toEqual(new Map());
    expect((await store.levels(nora, chatterB, [known])).get(known)?.level).toBe('standard');
  });

  it('takes his contest, and the ruling of a manager, never his own nor a chatter’s', async () => {
    const remarkId = crypto.randomUUID();
    await store.contest(nora, chatterA, member(chatterA), remarkId, 'Il avait dit non');
    expect(await store.rule(nora, chatterB, remarkId, 'dropped')).toBe('forbidden');
    expect(await store.rule(nora, manager, crypto.randomUUID(), 'dropped')).toBe('not_found');
    expect(await store.rule(nora, manager, remarkId, 'dropped')).toBe('ruled');
    expect((await store.contests(nora, chatterA, [remarkId])).get(remarkId)).toEqual({
      reason: 'Il avait dit non',
      ruling: 'dropped',
    });
    expect(await store.contests(nora, chatterB, [remarkId])).toEqual(new Map());

    const managers = crypto.randomUUID();
    await store.contest(nora, manager, member(manager), managers, 'Pas d’accord');
    expect(await store.rule(nora, manager, managers, 'upheld')).toBe('forbidden');
    expect(await store.rule(nora, owner, managers, 'upheld')).toBe('ruled');
  });
});
