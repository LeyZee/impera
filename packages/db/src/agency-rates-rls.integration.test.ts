import {
  CreatorAgencyRateIdSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withCreatorAccount, withTenantMember } from './client';
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
 * The agency's percentage of a creator (CR-04, ADR 0042 § 6): the owner alone reads and adds it, one per creator and
 * day, whole basis points, and nobody changes or removes one, the admin included. Invented people, creators and
 * percentages only (ADR 0010).
 */
describe('the agency’s percentage of a creator (CR-04): the owner’s alone, added only', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const creatorUser = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);

  const rate = (
    by: string,
    fromDay: string,
    values: Partial<typeof s.creatorAgencyRates.$inferInsert> = {},
  ) => ({
    id: newId(CreatorAgencyRateIdSchema),
    creatorId: nora,
    fromDay,
    agencyBps: 3_500,
    createdBy: by,
    ...values,
  });
  const add = (by: string, row: ReturnType<typeof rate>, creatorId = nora) =>
    withTenantMember(test.app.db, creatorId, by, (tx) => tx.insert(s.creatorAgencyRates).values(row));
  const read = (by: string, creatorId = nora) =>
    withTenantMember(test.app.db, creatorId, by, (tx) =>
      tx.select({ id: s.creatorAgencyRates.id }).from(s.creatorAgencyRates),
    ).then((rows) => rows.map((row) => row.id));

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
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [chatter, 'operator', 'chatter'],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx
          .insert(s.user)
          .values({ id: userId, name: `Compte ${role}`, email: `${userId}@example.test`, role });
        if (teamRole === null) continue;
        await tx.insert(s.teamMembers).values({
          id: newId(TeamMemberIdSchema),
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
      await tx.insert(s.user).values({
        id: creatorUser,
        name: 'Nora',
        email: 'nora@example.test',
        role: 'creator',
        creatorIds: [nora],
      });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('the owner alone adds it, under his own name, one per creator and day, in basis points', async () => {
    expect(await failure(add(manager, rate(manager, '2026-11-10')))).toMatch(/row-level security/u);
    expect(await failure(add(chatter, rate(chatter, '2026-11-10')))).toMatch(/row-level security/u);
    expect(await failure(add(owner, rate(manager, '2026-11-10')))).toMatch(/row-level security/u);
    // Under another creator's tenant, a row of Nora is refused.
    expect(await failure(add(owner, rate(owner, '2026-11-10'), ines))).toMatch(/row-level security/u);
    const first = rate(owner, '2026-11-10');
    await add(owner, first);
    expect(await failure(add(owner, rate(owner, '2026-11-10', { agencyBps: 3_000 })))).toMatch(
      /creator_agency_rates_creator_day_unique/u,
    );
    expect(await failure(add(owner, rate(owner, '2026-12-01', { agencyBps: 10_001 })))).toMatch(
      /creator_agency_rates_bps_check/u,
    );
    expect(await failure(add(owner, rate(owner, '2026-12-01', { agencyBps: -1 })))).toMatch(
      /creator_agency_rates_bps_check/u,
    );
    // Another creator has her own days.
    await add(owner, rate(owner, '2026-11-10', { creatorId: ines }), ines);
  });

  it('nobody changes or removes one, the admin included', async () => {
    const row = rate(owner, '2027-01-01');
    await add(owner, row);
    const changed = withTenantMember(test.app.db, nora, owner, (tx) =>
      tx.update(s.creatorAgencyRates).set({ agencyBps: 0 }).where(eq(s.creatorAgencyRates.id, row.id)),
    );
    expect(await failure(changed)).toMatch(/permission denied/u);
    const removed = withTenantMember(test.app.db, nora, owner, (tx) =>
      tx.delete(s.creatorAgencyRates).where(eq(s.creatorAgencyRates.id, row.id)),
    );
    expect(await failure(removed)).toMatch(/permission denied/u);
    const truncated = withTenantMember(test.app.db, nora, owner, (tx) =>
      tx.execute(sql`truncate creator_agency_rates`),
    );
    expect(await failure(truncated)).toMatch(/permission denied/u);
    const byAdmin = withAdmin(test.admin.db, (tx) =>
      tx.update(s.creatorAgencyRates).set({ agencyBps: 0 }).where(eq(s.creatorAgencyRates.id, row.id)),
    );
    expect(await failure(byAdmin)).toMatch(/an agency percentage is added only/u);
    const deletedByAdmin = withAdmin(test.admin.db, (tx) =>
      tx.delete(s.creatorAgencyRates).where(eq(s.creatorAgencyRates.id, row.id)),
    );
    expect(await failure(deletedByAdmin)).toMatch(/an agency percentage is added only/u);
  });

  it('the owner reads hers; a manager, a chatter and her own account read nothing', async () => {
    expect(await read(owner)).not.toEqual([]);
    expect(await read(manager)).toEqual([]);
    expect(await read(chatter)).toEqual([]);
    const hers = await withCreatorAccount(test.app.db, creatorUser, (tx) =>
      tx.select({ id: s.creatorAgencyRates.id }).from(s.creatorAgencyRates),
    );
    expect(hers).toEqual([]);
    // Under Inès, the owner reads Inès's only.
    const underInes = await read(owner, ines);
    expect(underInes).toHaveLength(1);
    expect(await read(owner)).not.toContain(underInes[0]);
  });
});
