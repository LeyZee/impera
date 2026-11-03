import { randomUUID } from 'node:crypto';

import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ContentRequestIdSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq } from 'drizzle-orm';
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
 * Her drops and the agency's requests (CR-06, migration 0106): she drops, withdraws what nothing has scheduled yet and
 * refuses a request, nothing else; the owner and an active manager read, drop for her, correct, withdraw, ask and
 * cancel; a chatter reads none of it. Invented people and creators only (ADR 0010).
 */
describe('her drops and the agency’s requests (CR-06): narrow writes for her, the rest to the agency', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraUser = newId(UserIdSchema);
  const inesUser = newId(UserIdSchema);
  const structureId = randomUUID();

  const drop = (creatorId: string, by: string, values: Partial<typeof s.contentDrops.$inferInsert> = {}) => ({
    id: newId(ContentDropIdSchema),
    creatorId,
    category: 'feed_shoot',
    createdBy: by,
    ...values,
  });
  const file = (creatorId: string, dropId: string, position = 0) => ({
    id: newId(ContentDropFileIdSchema),
    creatorId,
    dropId,
    position,
    kind: 'image',
    mime: 'image/jpeg',
    bytes: 2_000_000,
  });
  const request = (by: string, values: Partial<typeof s.contentRequests.$inferInsert> = {}) => ({
    id: newId(ContentRequestIdSchema),
    creatorId: nora,
    category: 'reveal_story',
    dueOn: '2026-11-07',
    reason: 'Ton stock de stories tient jusqu’à vendredi',
    origin: 'agency',
    createdBy: by,
    ...values,
  });
  const asNora = <T>(fn: Parameters<typeof withCreatorAccount<T>>[2]) =>
    withCreatorAccount(test.app.db, noraUser, fn);
  const asTeam = <T>(userId: string, fn: Parameters<typeof withTenantMember<T>>[3]) =>
    withTenantMember(test.app.db, nora, userId, fn);
  const stateOf = async (dropId: string) => {
    const [row] = await withAdmin(test.admin.db, (tx) =>
      tx.select().from(s.contentDrops).where(eq(s.contentDrops.id, dropId)),
    );
    return row;
  };

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
      for (const [userId, creatorId, name] of [
        [noraUser, nora, 'Nora'],
        [inesUser, ines, 'Inès'],
      ] as const)
        await tx.insert(s.user).values({
          id: userId,
          name,
          email: `${userId}@example.test`,
          role: 'creator',
          creatorIds: [creatorId],
        });
      await tx.insert(s.scriptStructures).values({ id: structureId, createdBy: owner });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('she drops for herself with her files, never for another creator, never past « sending »', async () => {
    const mine = drop(nora, noraUser);
    await asNora(async (tx) => {
      await tx.insert(s.contentDrops).values(mine);
      await tx.insert(s.contentDropFiles).values([file(nora, mine.id, 0), file(nora, mine.id, 1)]);
    });
    expect(await failure(asNora((tx) => tx.insert(s.contentDrops).values(drop(ines, noraUser))))).toMatch(
      /row-level security/u,
    );
    expect(
      await failure(
        asNora((tx) => tx.insert(s.contentDrops).values(drop(nora, noraUser, { state: 'ready' }))),
      ),
    ).toMatch(/row-level security/u);
    expect(await failure(asNora((tx) => tx.insert(s.contentDrops).values(drop(nora, owner))))).toMatch(
      /row-level security/u,
    );
    // Inès sees nothing of Nora's, a chatter nothing at all.
    const seen = await withCreatorAccount(test.app.db, inesUser, (tx) => tx.select().from(s.contentDrops));
    expect(seen).toEqual([]);
    expect(await asTeam(chatter, (tx) => tx.select().from(s.contentDrops))).toEqual([]);
    expect(await asTeam(chatter, (tx) => tx.select().from(s.contentDropFiles))).toEqual([]);
    expect(await asTeam(manager, (tx) => tx.select().from(s.contentDropFiles))).toHaveLength(2);
  });

  it('she withdraws a drop nothing has scheduled, and changes nothing else of it', async () => {
    const mine = drop(nora, noraUser, { sentence: 'Séance au bord de la piscine' });
    await asNora((tx) => tx.insert(s.contentDrops).values(mine));
    expect(
      await failure(
        asNora((tx) =>
          tx.update(s.contentDrops).set({ category: 'feed_video' }).where(eq(s.contentDrops.id, mine.id)),
        ),
      ),
    ).toMatch(/only withdraws/u);
    await asNora((tx) =>
      tx
        .update(s.contentDrops)
        .set({ state: 'withdrawn', withdrawnAt: new Date(), withdrawnBy: noraUser })
        .where(eq(s.contentDrops.id, mine.id)),
    );
    expect((await stateOf(mine.id))?.state).toBe('withdrawn');
    // A withdrawn drop never comes back, for anyone.
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx
            .update(s.contentDrops)
            .set({ state: 'received', withdrawnAt: null, withdrawnBy: null })
            .where(eq(s.contentDrops.id, mine.id)),
        ),
      ),
    ).toMatch(/refused/u);
    // A file never joins it any more.
    expect(await failure(asNora((tx) => tx.insert(s.contentDropFiles).values(file(nora, mine.id))))).toMatch(
      /row-level security/u,
    );
  });

  it('she never withdraws a scheduled drop, never touches a file, never deletes', async () => {
    const mine = drop(nora, noraUser);
    await asNora(async (tx) => {
      await tx.insert(s.contentDrops).values(mine);
      await tx.insert(s.contentDropFiles).values(file(nora, mine.id));
    });
    await withAdmin(test.admin.db, (tx) =>
      tx.update(s.contentDrops).set({ state: 'scheduled' }).where(eq(s.contentDrops.id, mine.id)),
    );
    const withdrawn = await asNora((tx) =>
      tx
        .update(s.contentDrops)
        .set({ state: 'withdrawn', withdrawnAt: new Date(), withdrawnBy: noraUser })
        .where(eq(s.contentDrops.id, mine.id))
        .returning(),
    );
    expect(withdrawn).toEqual([]);
    expect(
      await failure(
        asNora((tx) =>
          tx.update(s.contentDropFiles).set({ bytes: 1 }).where(eq(s.contentDropFiles.dropId, mine.id)),
        ),
      ),
    ).toMatch(/permission denied/u);
    expect(
      await failure(asNora((tx) => tx.delete(s.contentDrops).where(eq(s.contentDrops.id, mine.id)))),
    ).toMatch(/permission denied/u);
  });

  it('the agency corrects her category, kept with her choice, and never moves a state but to withdrawn', async () => {
    const mine = drop(nora, noraUser);
    await asNora((tx) => tx.insert(s.contentDrops).values(mine));
    await asTeam(manager, (tx) =>
      tx
        .update(s.contentDrops)
        .set({
          category: 'reveal_story',
          correctedFrom: 'feed_shoot',
          correctedBy: manager,
          correctedAt: new Date(),
        })
        .where(eq(s.contentDrops.id, mine.id)),
    );
    expect(
      await asNora((tx) => tx.select().from(s.contentDrops).where(eq(s.contentDrops.id, mine.id))),
    ).toEqual([expect.objectContaining({ category: 'reveal_story', correctedFrom: 'feed_shoot' })]);
    expect(
      await failure(
        asTeam(owner, (tx) =>
          tx.update(s.contentDrops).set({ state: 'ready' }).where(eq(s.contentDrops.id, mine.id)),
        ),
      ),
    ).toMatch(/only withdraws a drop/u);
    // A chatter changes nothing.
    const changed = await asTeam(chatter, (tx) =>
      tx
        .update(s.contentDrops)
        .set({
          category: 'mass_dm',
          correctedFrom: 'reveal_story',
          correctedBy: chatter,
          correctedAt: new Date(),
        })
        .where(eq(s.contentDrops.id, mine.id))
        .returning(),
    );
    expect(changed).toEqual([]);
    // The agency drops for her too.
    await asTeam(owner, (tx) => tx.insert(s.contentDrops).values(drop(nora, owner)));
  });

  it('a script is dropped only from her open request for it, one drop at a time', async () => {
    expect(
      await failure(
        asNora((tx) => tx.insert(s.contentDrops).values(drop(nora, noraUser, { category: 'script' }))),
      ),
    ).toMatch(/content_drops_script_check/u);
    const asked = request(owner, { category: 'script', structureId });
    await asTeam(owner, (tx) => tx.insert(s.contentRequests).values(asked));
    // Not under another category than the one asked.
    expect(
      await failure(
        asNora((tx) =>
          tx
            .insert(s.contentDrops)
            .values(drop(nora, noraUser, { category: 'mass_dm', requestId: asked.id })),
        ),
      ),
    ).toMatch(/row-level security/u);
    const answer = drop(nora, noraUser, { category: 'script', requestId: asked.id });
    await asNora((tx) => tx.insert(s.contentDrops).values(answer));
    expect(
      await failure(
        asNora((tx) =>
          tx.insert(s.contentDrops).values(drop(nora, noraUser, { category: 'script', requestId: asked.id })),
        ),
      ),
    ).toMatch(/content_drops_request_live_unique/u);
    // Inès never answers Nora's request.
    expect(
      await failure(
        withCreatorAccount(test.app.db, inesUser, (tx) =>
          tx.insert(s.contentDrops).values(drop(ines, inesUser, { category: 'script', requestId: asked.id })),
        ),
      ),
    ).toMatch(/row-level security|content_drops_request_fk/u);
  });

  it('she refuses an open request and nothing else of it; the agency cancels; neither reopens', async () => {
    const asked = request(manager);
    await asTeam(manager, (tx) => tx.insert(s.contentRequests).values(asked));
    expect(await failure(asNora((tx) => tx.insert(s.contentRequests).values(request(noraUser))))).toMatch(
      /row-level security/u,
    );
    expect(
      await failure(
        asNora((tx) =>
          tx
            .update(s.contentRequests)
            .set({ state: 'refused', decidedAt: new Date(), dueOn: '2026-12-01' })
            .where(eq(s.contentRequests.id, asked.id)),
        ),
      ),
    ).toMatch(/only refuses/u);
    await asNora((tx) =>
      tx
        .update(s.contentRequests)
        .set({ state: 'refused', decidedAt: new Date(), refusalReason: 'Pas de shooting cette semaine' })
        .where(eq(s.contentRequests.id, asked.id)),
    );
    // Closed: the agency's policy no longer sees it to change, and the trigger refuses it to the admin too.
    const reopened = await asTeam(owner, (tx) =>
      tx
        .update(s.contentRequests)
        .set({ state: 'open', decidedAt: null, refusalReason: null })
        .where(eq(s.contentRequests.id, asked.id))
        .returning(),
    );
    expect(reopened).toEqual([]);
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx
            .update(s.contentRequests)
            .set({ state: 'open', decidedAt: null, refusalReason: null })
            .where(eq(s.contentRequests.id, asked.id)),
        ),
      ),
    ).toMatch(/refused/u);
    const other = request(owner);
    await asTeam(owner, (tx) => tx.insert(s.contentRequests).values(other));
    // The agency never refuses in her name.
    expect(
      await failure(
        asTeam(owner, (tx) =>
          tx
            .update(s.contentRequests)
            .set({ state: 'refused', decidedAt: new Date() })
            .where(eq(s.contentRequests.id, other.id)),
        ),
      ),
    ).toMatch(/row-level security/u);
    await asTeam(owner, (tx) =>
      tx
        .update(s.contentRequests)
        .set({ state: 'cancelled', decidedAt: new Date() })
        .where(eq(s.contentRequests.id, other.id)),
    );
    // She never cancels.
    const third = request(owner);
    await asTeam(owner, (tx) => tx.insert(s.contentRequests).values(third));
    expect(
      await failure(
        asNora((tx) =>
          tx
            .update(s.contentRequests)
            .set({ state: 'cancelled', decidedAt: new Date() })
            .where(eq(s.contentRequests.id, third.id)),
        ),
      ),
    ).toMatch(/row-level security/u);
  });
});
