import { randomUUID } from 'node:crypto';

import { CreatorIdSchema, newId, TeamMemberIdSchema, UserIdSchema } from '@nirvana/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withCreatorAccount, withMember, withTenant, withTenantMember } from './client';
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

const SEGMENTS = [
  {
    kind: 'stage',
    key: 'salon',
    name: 'Salon',
    intention: 'Elle se dévoile',
    access: 'paid',
    mood: null,
    mediaSlots: [{ kind: 'image', optional: false, hint: null }],
    variants: [],
  },
];

/** ADR 0056 § 1: the agency's library under the team's policies, frozen versions, the queue under her RLS. */
describe('script structures (SC-01)', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const creatorUser = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const structureId = randomUUID();

  const versionRow = (version: number, by = owner) => ({
    id: randomUUID(),
    structureId,
    version,
    name: 'Soirée au salon',
    moment: 'night',
    color: { primary: '#5c1029', secondary: '#911e42', accent: '#b03a78' },
    segments: SEGMENTS,
    updatedBy: by,
  });

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [label, id] of [
        ['Nora', nora],
        ['Inès', ines],
      ] as const) {
        await tx
          .insert(s.creators)
          .values({ id, nameKey: id, displayName: `Créatrice ${label}`, timezone: 'Europe/Paris' });
      }
      const people = [
        [owner, 'owner', null],
        [manager, 'operator', 'manager'],
        [chatter, 'operator', 'chatter'],
        [creatorUser, 'creator', null],
      ] as const;
      for (const [userId, role, teamRole] of people) {
        await tx.insert(s.user).values({
          id: userId,
          name: `Compte ${role}`,
          email: `${userId}@example.test`,
          role,
          creatorIds: role === 'creator' ? [nora] : [],
        });
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
    });
  });

  afterAll(async () => {
    await test.close();
  });

  describe('the library', () => {
    it('is written by the owner alone', async () => {
      expect(
        await failure(
          withMember(test.app.db, manager, (tx) =>
            tx.insert(s.scriptStructures).values({ id: randomUUID(), createdBy: manager }),
          ),
        ),
      ).toMatch(/row-level security/u);
      expect(
        await failure(
          withMember(test.app.db, owner, async (tx) => {
            await tx.insert(s.scriptStructures).values({ id: structureId, createdBy: owner });
            await tx.insert(s.scriptStructureVersions).values(versionRow(1));
          }),
        ),
      ).toBe('no error');
    });

    it('is read by the owner and an active manager, never by a chatter or her account', async () => {
      const read = (userId: string) =>
        withMember(test.app.db, userId, (tx) => tx.select().from(s.scriptStructureVersions));
      expect(await read(owner)).toHaveLength(1);
      expect(await read(manager)).toHaveLength(1);
      expect(await read(chatter)).toHaveLength(0);
      expect(await read(creatorUser)).toHaveLength(0);
      expect(await withTenant(test.app.db, nora, (tx) => tx.select().from(s.scriptStructures))).toHaveLength(
        0,
      );
    });
  });

  describe('a frozen version (rule 6)', () => {
    it('changes in place until frozen, then never again, whoever asks', async () => {
      const rename = (name: string) =>
        withMember(test.app.db, owner, (tx) =>
          tx
            .update(s.scriptStructureVersions)
            .set({ name, updatedBy: owner })
            .where(eq(s.scriptStructureVersions.structureId, structureId)),
        );
      expect(await failure(rename('Soirée au salon, bis'))).toBe('no error');
      await withAdmin(test.admin.db, (tx) =>
        tx
          .update(s.scriptStructureVersions)
          .set({ frozenAt: new Date() })
          .where(eq(s.scriptStructureVersions.structureId, structureId)),
      );
      expect(await failure(rename('Changée'))).toMatch(/frozen/u);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .update(s.scriptStructureVersions)
              .set({ frozenAt: null })
              .where(eq(s.scriptStructureVersions.structureId, structureId)),
          ),
        ),
      ).toMatch(/frozen/u);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx
              .delete(s.scriptStructureVersions)
              .where(eq(s.scriptStructureVersions.structureId, structureId)),
          ),
        ),
      ).toMatch(/frozen/u);
      expect(
        await failure(
          withMember(test.app.db, owner, (tx) => tx.insert(s.scriptStructureVersions).values(versionRow(2))),
        ),
      ).toBe('no error');
    });

    it('keeps its number and is never removed, even before it is frozen', async () => {
      const latest = (tx: Parameters<Parameters<typeof withAdmin>[1]>[0]) =>
        tx
          .update(s.scriptStructureVersions)
          .set({ version: 9 })
          .where(eq(s.scriptStructureVersions.version, 2));
      expect(await failure(withAdmin(test.admin.db, latest))).toMatch(/frozen/u);
      expect(
        await failure(
          withAdmin(test.admin.db, (tx) =>
            tx.delete(s.scriptStructureVersions).where(eq(s.scriptStructureVersions.version, 2)),
          ),
        ),
      ).toMatch(/frozen/u);
    });
  });

  describe('the queue', () => {
    const entry = (creatorId: string, position: number, by = owner) => ({
      creatorId,
      position,
      structureId,
      addedBy: by,
    });

    it('is written by the owner inside her, and read by the agency inside her only', async () => {
      expect(
        await failure(
          withTenantMember(test.app.db, nora, manager, (tx) =>
            tx.insert(s.scriptStructureQueue).values(entry(nora, 1, manager)),
          ),
        ),
      ).toMatch(/row-level security/u);
      expect(
        await failure(
          withTenantMember(test.app.db, nora, owner, (tx) =>
            tx.insert(s.scriptStructureQueue).values(entry(ines, 1)),
          ),
        ),
      ).toMatch(/row-level security/u);
      expect(
        await failure(
          withTenantMember(test.app.db, nora, owner, (tx) =>
            tx.insert(s.scriptStructureQueue).values(entry(nora, 1)),
          ),
        ),
      ).toBe('no error');
      const read = (creatorId: string, userId: string) =>
        withTenantMember(test.app.db, creatorId, userId, (tx) => tx.select().from(s.scriptStructureQueue));
      expect(await read(nora, manager)).toHaveLength(1);
      expect(await read(ines, owner)).toHaveLength(0);
      expect(await read(nora, chatter)).toHaveLength(0);
      expect(await read(nora, creatorUser)).toHaveLength(0);
      // Her own account (CR-02): closed outright, the library as much as her queue.
      expect(
        await withCreatorAccount(test.app.db, creatorUser, async (tx) => [
          ...(await tx.select().from(s.scriptStructureQueue)),
          ...(await tx.select().from(s.scriptStructureVersions)),
          ...(await tx.select().from(s.scriptStructures)),
        ]),
      ).toEqual([]);
      expect(
        await withTenant(test.app.db, nora, (tx) => tx.select().from(s.scriptStructureQueue)),
      ).toHaveLength(0);
    });

    it('takes a structure once per creator', async () => {
      expect(
        await failure(
          withTenantMember(test.app.db, nora, owner, (tx) =>
            tx.insert(s.scriptStructureQueue).values(entry(nora, 2)),
          ),
        ),
      ).toMatch(/script_structure_queue_structure_unique/u);
    });
  });
});
