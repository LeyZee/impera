import { CreatorIdSchema, newId, TeamMemberIdSchema, UserIdSchema } from '@impera/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withTenantMember } from './client';
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

/** Invented people, creators and faults only (ADR 0010). */
describe('the chatter review (ADR 0170 §§ 14, 28, 29): levels, explanations, contests, rulings', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatterA = newId(UserIdSchema);
  const chatterB = newId(UserIdSchema);
  const memberOf = new Map<string, string>();
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const code = 'fault.example_one';

  const member = (userId: string): string => {
    const memberId = memberOf.get(userId);
    if (memberId === undefined) throw new Error('no member');
    return memberId;
  };
  const as = <T>(by: string, creator: string, run: Parameters<typeof withTenantMember<T>>[3]): Promise<T> =>
    withTenantMember(test.app.db, creator, by, run);
  const remark = (): string => crypto.randomUUID();
  const contest = (by: string, remarkId: string, memberId = member(by), creator = nora) =>
    as(by, creator, (tx) =>
      tx
        .insert(s.chatterRemarkContests)
        .values({ remarkId, creatorId: creator, memberId, reason: 'Il avait dit non' }),
    );
  const rule = (by: string, remarkId: string, creator = nora) =>
    as(by, creator, (tx) =>
      tx
        .insert(s.chatterRemarkRulings)
        .values({ remarkId, creatorId: creator, ruling: 'dropped', saidBy: by }),
    );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [label, creatorId] of [
        ['Nora', nora],
        ['Inès', ines],
      ] as const) {
        await tx.insert(s.creators).values({
          id: creatorId,
          nameKey: creatorId,
          displayName: `Créatrice ${label}`,
          timezone: 'Europe/Paris',
        });
      }
      const people = [
        [owner, 'owner', null, []],
        [manager, 'operator', 'manager', [nora]],
        [chatterA, 'operator', 'chatter', [nora]],
        [chatterB, 'operator', 'chatter', [nora]],
      ] as const;
      for (const [userId, role, teamRole, creatorIds] of people) {
        await tx.insert(s.user).values({
          id: userId,
          name: `Compte ${role}`,
          email: `${userId}@example.test`,
          role,
          creatorIds: [...creatorIds],
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
          displayName: `Membre ${teamRole}`,
          country: 'BJ',
          timeZone: 'Africa/Porto-Novo',
          joinedOn: '2026-10-01',
        });
      }
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('only the owner saves a level; every member reads it', async () => {
    expect(
      await failure(
        as(manager, nora, (tx) =>
          tx
            .insert(s.chatterFaultLevels)
            .values({ faultCode: code, level: 'firm', label: 'Une faute', updatedBy: manager }),
        ),
      ),
    ).toMatch(/row-level security/u);
    await as(owner, nora, (tx) =>
      tx
        .insert(s.chatterFaultLevels)
        .values({ faultCode: code, level: 'standard', label: 'Une faute', updatedBy: owner }),
    );
    const read = await as(chatterA, nora, (tx) => tx.select().from(s.chatterFaultLevels));
    expect(read.map((r) => r.level)).toEqual(['standard']);
    const changed = await as(manager, nora, (tx) =>
      tx
        .update(s.chatterFaultLevels)
        .set({ level: 'advice' })
        .where(eq(s.chatterFaultLevels.faultCode, code))
        .returning(),
    );
    expect(changed).toEqual([]);
    expect(
      await failure(
        as(owner, nora, (tx) =>
          tx
            .insert(s.chatterFaultLevels)
            .values({ faultCode: 'Fault.BAD', level: 'firm', label: 'x', updatedBy: owner }),
        ),
      ),
    ).toMatch(/chatter_fault_levels_code_check/u);
  });

  it('a chatter records his own explanation once; nobody else, and nobody undoes it', async () => {
    await as(chatterA, nora, (tx) =>
      tx
        .insert(s.chatterFaultExplanations)
        .values({ creatorId: nora, memberId: member(chatterA), faultCode: code, remarkId: remark() }),
    );
    expect(
      await failure(
        as(chatterB, nora, (tx) =>
          tx
            .insert(s.chatterFaultExplanations)
            .values({ creatorId: nora, memberId: member(chatterA), faultCode: code, remarkId: remark() }),
        ),
      ),
    ).toMatch(/row-level security/u);
    expect(await as(chatterB, nora, (tx) => tx.select().from(s.chatterFaultExplanations))).toEqual([]);
    expect(await as(manager, nora, (tx) => tx.select().from(s.chatterFaultExplanations))).toHaveLength(1);
    expect(await as(manager, ines, (tx) => tx.select().from(s.chatterFaultExplanations))).toEqual([]);
    expect(await failure(as(chatterA, nora, (tx) => tx.delete(s.chatterFaultExplanations)))).toMatch(
      /permission denied|append-only|refuse/u,
    );
  });

  it('a chatter contests his own remark; a manager settles it, never his own; nothing is changed after', async () => {
    const mine = remark();
    expect(await failure(contest(chatterB, mine, member(chatterA)))).toMatch(/row-level security/u);
    await contest(chatterA, mine);
    expect(await as(chatterB, nora, (tx) => tx.select().from(s.chatterRemarkContests))).toEqual([]);
    expect(await failure(rule(chatterA, mine))).toMatch(/row-level security/u);
    await rule(manager, mine);
    const read = await as(chatterA, nora, (tx) => tx.select().from(s.chatterRemarkRulings));
    expect(read.map((r) => r.ruling)).toEqual(['dropped']);
    expect(
      await failure(as(manager, nora, (tx) => tx.update(s.chatterRemarkRulings).set({ ruling: 'upheld' }))),
    ).toMatch(/permission denied|append-only|refuse/u);

    const managers = remark();
    await contest(manager, managers);
    expect(await failure(rule(manager, managers))).toMatch(/row-level security/u);
    await rule(owner, managers);
  });

  it('a manager of another creator settles nothing there', async () => {
    const other = remark();
    await withAdmin(test.admin.db, (tx) =>
      tx
        .insert(s.chatterRemarkContests)
        .values({ remarkId: other, creatorId: ines, memberId: member(chatterA), reason: 'Non' }),
    );
    expect(await failure(rule(manager, other, ines))).toMatch(/row-level security/u);
  });
});
