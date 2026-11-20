import { CreatorIdSchema, newId, TeamMemberIdSchema, UserIdSchema } from '@impera/contracts';
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
 * Her grid of custom prices (ADR 0159 § C): the owner's alone. The server writes it as the service role; the owner
 * reads the creator at hand; a manager, a chatter and her own account read nothing; nobody writes it as the
 * application role. Invented people and creators, and no price: the grid stored here is an empty object (ADR 0010).
 */
describe('her custom price grid (ADR 0159): the owner reads, the server writes', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraUser = newId(UserIdSchema);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [label, creatorId] of [
        ['Nora', nora],
        ['Inès', ines],
      ] as const)
        await tx.insert(s.creators).values({
          id: creatorId,
          nameKey: creatorId,
          displayName: `Créatrice ${label}`,
          timezone: 'Europe/Paris',
        });
      for (const [userId, role, teamRole] of [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [chatter, 'operator', 'chatter'],
      ] as const) {
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
        id: noraUser,
        name: 'Nora',
        email: `${noraUser}@example.test`,
        role: 'creator',
        creatorIds: [nora],
      });
    });
    // The server's write: the service role, as the module does after the owner's check.
    await withAdmin(test.service.db, (tx) =>
      tx.insert(s.customPriceGrids).values([
        { creatorId: nora, version: 1, grid: {}, createdBy: owner },
        { creatorId: ines, version: 1, grid: {}, createdBy: owner },
      ]),
    );
  });

  afterAll(async () => {
    await test.close();
  });

  const versionsSeen = (creatorId: string, userId: string) =>
    withTenantMember(test.app.db, creatorId, userId, (tx) =>
      tx.select({ creatorId: s.customPriceGrids.creatorId }).from(s.customPriceGrids),
    );

  it('the owner reads the grid of the creator at hand, never another’s', async () => {
    expect(await versionsSeen(nora, owner)).toEqual([{ creatorId: nora }]);
  });

  it('a manager and a chatter read nothing', async () => {
    expect(await versionsSeen(nora, manager)).toEqual([]);
    expect(await versionsSeen(nora, chatter)).toEqual([]);
  });

  it('her own account reads nothing and writes nothing', async () => {
    expect(
      await withCreatorAccount(test.app.db, noraUser, (tx) => tx.select().from(s.customPriceGrids)),
    ).toEqual([]);
    expect(
      await failure(
        withCreatorAccount(test.app.db, noraUser, (tx) =>
          tx.insert(s.customPriceGrids).values({ creatorId: nora, version: 2, grid: {} }),
        ),
      ),
    ).toMatch(/permission denied/u);
  });

  it('the application role never writes it, even for the owner', async () => {
    expect(
      await failure(
        withTenantMember(test.app.db, nora, owner, (tx) =>
          tx.insert(s.customPriceGrids).values({ creatorId: nora, version: 2, grid: {} }),
        ),
      ),
    ).toMatch(/permission denied/u);
  });

  it('refuses a version under 1, a grid that is not an object, and a version saved twice', async () => {
    const insert = (version: number, grid: unknown) =>
      failure(
        withAdmin(test.service.db, (tx) =>
          tx.insert(s.customPriceGrids).values({ creatorId: nora, version, grid }),
        ),
      );
    expect(await insert(0, {})).toMatch(/custom_price_grids_version_check/u);
    expect(await insert(2, [])).toMatch(/custom_price_grids_grid_check/u);
    expect(await insert(1, {})).toMatch(/custom_price_grids_pkey/u);
  });
});
