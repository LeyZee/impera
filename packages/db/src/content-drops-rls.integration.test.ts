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
 * Her drops and the agency's requests (CR-06, migration 0108): she drops, withdraws what nothing has scheduled yet and
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

  it('bounds a file’s weight by its kind in the base too', async () => {
    const mine = drop(nora, noraUser);
    await asNora((tx) => tx.insert(s.contentDrops).values(mine));
    expect(
      await failure(
        asNora((tx) =>
          tx.insert(s.contentDropFiles).values({ ...file(nora, mine.id), bytes: 31 * 1024 * 1024 }),
        ),
      ),
    ).toMatch(/content_drop_files_bytes_check/u);
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

  it('she withdraws a blocked drop, its reason kept: her guard never lets her clear it (grande recette du 21/11)', async () => {
    const blocked = drop(nora, noraUser);
    await asNora((tx) => tx.insert(s.contentDrops).values(blocked));
    await withAdmin(test.admin.db, (tx) =>
      tx
        .update(s.contentDrops)
        .set({ state: 'blocked', blockedReason: 'Aucun fichier gardé' })
        .where(eq(s.contentDrops.id, blocked.id)),
    );
    expect(
      await failure(
        asNora((tx) =>
          tx.update(s.contentDrops).set({ blockedReason: null }).where(eq(s.contentDrops.id, blocked.id)),
        ),
      ),
    ).toMatch(/only withdraws|permission denied/u);
    await asNora((tx) =>
      tx
        .update(s.contentDrops)
        .set({ state: 'withdrawn', withdrawnAt: new Date(), withdrawnBy: noraUser })
        .where(eq(s.contentDrops.id, blocked.id)),
    );
    expect(await stateOf(blocked.id)).toMatchObject({
      state: 'withdrawn',
      blockedReason: 'Aucun fichier gardé',
    });
    // A reason still never stands on a drop that is neither blocked nor withdrawn.
    const ready = drop(nora, noraUser);
    await asNora((tx) => tx.insert(s.contentDrops).values(ready));
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx
            .update(s.contentDrops)
            .set({ state: 'ready', blockedReason: 'Aucun fichier gardé' })
            .where(eq(s.contentDrops.id, ready.id)),
        ),
      ),
    ).toMatch(/content_drops_blocked_check/u);
  });

  it('only her team withdraws a drop with « À refaire », a sentence of 1 to 200 characters (trou 7 du 21/11)', async () => {
    const mine = drop(nora, noraUser);
    await asNora((tx) => tx.insert(s.contentDrops).values(mine));
    const withdrawn = { state: 'withdrawn', withdrawnAt: new Date(), withdrawnBy: noraUser } as const;
    expect(
      await failure(
        asNora((tx) =>
          tx
            .update(s.contentDrops)
            .set({ ...withdrawn, redoSentence: 'Je me le demande moi-même' })
            .where(eq(s.contentDrops.id, mine.id)),
        ),
      ),
    ).toMatch(/only her team asks a drop again/u);
    // Never on a live drop, never empty.
    expect(
      await failure(
        asTeam(manager, (tx) =>
          tx
            .update(s.contentDrops)
            .set({ redoSentence: 'Trop sombre' })
            .where(eq(s.contentDrops.id, mine.id)),
        ),
      ),
    ).toMatch(/content_drops_redo_check/u);
    expect(
      await failure(
        asTeam(manager, (tx) =>
          tx
            .update(s.contentDrops)
            .set({ ...withdrawn, withdrawnBy: manager, redoSentence: '' })
            .where(eq(s.contentDrops.id, mine.id)),
        ),
      ),
    ).toMatch(/content_drops_redo_check/u);
    await asTeam(manager, (tx) =>
      tx
        .update(s.contentDrops)
        .set({
          ...withdrawn,
          withdrawnBy: manager,
          redoSentence: 'Trop sombre, refais-la avec plus de lumière',
        })
        .where(eq(s.contentDrops.id, mine.id)),
    );
    expect(await stateOf(mine.id)).toMatchObject({
      state: 'withdrawn',
      redoSentence: 'Trop sombre, refais-la avec plus de lumière',
    });
    // She never wipes it: refused, or her policy does not even reach a withdrawn drop.
    await failure(
      asNora((tx) =>
        tx.update(s.contentDrops).set({ redoSentence: null }).where(eq(s.contentDrops.id, mine.id)),
      ),
    );
    expect((await stateOf(mine.id))?.redoSentence).toBe('Trop sombre, refais-la avec plus de lumière');
  });

  it('only her team asks one medium again, on a drop received and not out, and only the server resets its export', async () => {
    const mine = drop(nora, noraUser);
    const medium = file(nora, mine.id);
    await asNora(async (tx) => {
      await tx.insert(s.contentDrops).values(mine);
      await tx.insert(s.contentDropFiles).values(medium);
    });
    const ask = (sentence: string | null) => ({
      redoSentence: sentence,
      redoAt: new Date(),
      redoBy: manager,
    });
    const fileOf = async () => {
      const [row] = await withAdmin(test.admin.db, (tx) =>
        tx.select().from(s.contentDropFiles).where(eq(s.contentDropFiles.id, medium.id)),
      );
      return row;
    };
    // Still on its way: nothing to ask again.
    expect(
      await asTeam(manager, (tx) =>
        tx
          .update(s.contentDropFiles)
          .set(ask('Trop sombre'))
          .where(eq(s.contentDropFiles.id, medium.id))
          .returning(),
      ),
    ).toEqual([]);
    await withAdmin(test.admin.db, (tx) =>
      tx.update(s.contentDrops).set({ state: 'received' }).where(eq(s.contentDrops.id, mine.id)),
    );
    // Never by her, never by a chatter, never empty.
    await failure(
      asNora((tx) =>
        tx.update(s.contentDropFiles).set(ask('Moi')).where(eq(s.contentDropFiles.id, medium.id)),
      ),
    );
    expect(
      await asTeam(chatter, (tx) =>
        tx
          .update(s.contentDropFiles)
          .set(ask('Trop sombre'))
          .where(eq(s.contentDropFiles.id, medium.id))
          .returning(),
      ),
    ).toEqual([]);
    expect((await fileOf())?.redoSentence).toBeNull();
    expect(
      await failure(
        asTeam(manager, (tx) =>
          tx.update(s.contentDropFiles).set(ask('')).where(eq(s.contentDropFiles.id, medium.id)),
        ),
      ),
    ).toMatch(/content_drop_files_redo_check/u);
    await asTeam(manager, (tx) =>
      tx.update(s.contentDropFiles).set(ask('Trop sombre')).where(eq(s.contentDropFiles.id, medium.id)),
    );
    expect((await fileOf())?.redoSentence).toBe('Trop sombre');
    // Out on her feed: no longer asked.
    await withAdmin(test.admin.db, (tx) =>
      tx
        .update(s.contentDrops)
        .set({ state: 'ready', exportedAt: new Date(), exportedBy: owner })
        .where(eq(s.contentDrops.id, mine.id)),
    );
    expect(
      await asTeam(owner, (tx) =>
        tx
          .update(s.contentDropFiles)
          .set(ask('Autre'))
          .where(eq(s.contentDropFiles.id, medium.id))
          .returning(),
      ),
    ).toEqual([]);
    // An export is taken back by the server alone, for a script, in the transaction that says so.
    const reset = { exportedAt: null, exportedBy: null } as const;
    expect(
      await failure(
        withAdmin(test.admin.db, async (tx) => {
          await tx.execute(sql`select set_config('app.export_reset', 'on', true)`);
          await tx.update(s.contentDrops).set(reset).where(eq(s.contentDrops.id, mine.id));
        }),
      ),
    ).toMatch(/an export is confirmed once/u);
    const script = drop(nora, owner, {
      category: 'script',
      requestId: await withAdmin(test.admin.db, async (tx) => {
        const asked = request(owner, { category: 'script', structureId });
        await tx.insert(s.contentRequests).values(asked);
        return asked.id;
      }),
      state: 'ready',
      scriptNumber: 1,
      exportedAt: new Date(),
      exportedBy: owner,
    });
    await withAdmin(test.admin.db, (tx) => tx.insert(s.contentDrops).values(script));
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx.update(s.contentDrops).set(reset).where(eq(s.contentDrops.id, script.id)),
        ),
      ),
    ).toMatch(/an export is confirmed once/u);
    expect(
      await failure(
        asTeam(owner, async (tx) => {
          await tx.execute(sql`select set_config('app.export_reset', 'on', true)`);
          await tx.update(s.contentDrops).set(reset).where(eq(s.contentDrops.id, script.id));
        }),
      ),
    ).toMatch(/an export is confirmed once|permission denied/u);
    await withAdmin(test.admin.db, async (tx) => {
      await tx.execute(sql`select set_config('app.export_reset', 'on', true)`);
      await tx.update(s.contentDrops).set(reset).where(eq(s.contentDrops.id, script.id));
    });
    expect(await stateOf(script.id)).toMatchObject({ exportedAt: null, exportedBy: null });
  });

  it('she replaces a medium asked again or refused, in place, and nothing else; another creator never does', async () => {
    const mine = drop(nora, noraUser);
    const asked = file(nora, mine.id, 0);
    const pending = file(nora, mine.id, 1);
    await asNora(async (tx) => {
      await tx.insert(s.contentDrops).values(mine);
      await tx.insert(s.contentDropFiles).values([asked, pending]);
    });
    await withAdmin(test.admin.db, async (tx) => {
      await tx.update(s.contentDrops).set({ state: 'ready' }).where(eq(s.contentDrops.id, mine.id));
      await tx
        .update(s.contentDropFiles)
        .set({ state: 'refused', refusal: 'Photo illisible' })
        .where(eq(s.contentDropFiles.id, asked.id));
      await tx
        .update(s.contentDropFiles)
        .set({ state: 'received' })
        .where(eq(s.contentDropFiles.id, pending.id));
    });
    const asInes = <T>(fn: Parameters<typeof withCreatorAccount<T>>[2]) =>
      withCreatorAccount(test.app.db, inesUser, fn);
    const markReplaced = (id: string) => (tx: Parameters<Parameters<typeof asNora>[0]>[0]) =>
      tx
        .update(s.contentDropFiles)
        .set({ replacedAt: new Date() })
        .where(eq(s.contentDropFiles.id, id))
        .returning({ id: s.contentDropFiles.id });
    const after = (position: number, values: Partial<typeof s.contentDropFiles.$inferInsert> = {}) => ({
      ...file(nora, mine.id, position),
      ...values,
    });
    const rowOf = async (id: string) => {
      const [row] = await withAdmin(test.admin.db, (tx) =>
        tx.select().from(s.contentDropFiles).where(eq(s.contentDropFiles.id, id)),
      );
      return row;
    };

    // Another creator: neither her file nor a file in her drop, under either name.
    expect(await asInes(markReplaced(asked.id))).toEqual([]);
    // Nothing is replaced in place of a file still there.
    expect(await failure(asNora((tx) => tx.insert(s.contentDropFiles).values(after(0))))).toMatch(
      /row-level security/u,
    );
    // A medium neither asked again nor refused is not hers to swap.
    expect(await asNora(markReplaced(pending.id))).toEqual([]);
    // Only `replaced_at`, and never back to empty.
    expect(
      await failure(
        asNora((tx) =>
          tx.update(s.contentDropFiles).set({ bytes: 1 }).where(eq(s.contentDropFiles.id, asked.id)),
        ),
      ),
    ).toMatch(/permission denied/u);
    expect(
      await failure(
        asNora((tx) =>
          tx.update(s.contentDropFiles).set({ replacedAt: null }).where(eq(s.contentDropFiles.id, asked.id)),
        ),
      ),
    ).toMatch(/row-level security/u);
    expect(await asNora(markReplaced(asked.id))).toEqual([{ id: asked.id }]);
    expect(
      await asNora((tx) =>
        tx
          .update(s.contentDropFiles)
          .set({ replacedAt: null })
          .where(eq(s.contentDropFiles.id, asked.id))
          .returning(),
      ),
    ).toEqual([]);
    expect((await rowOf(asked.id))?.replacedAt).not.toBeNull();

    // The new one: at the old one's place and slot, waiting for its bytes, nothing settled on it.
    for (const wrong of [
      after(1),
      after(0, { slotKey: 'salon::0' }),
      after(0, { state: 'kept' }),
      after(0, { redoSentence: 'Moi' }),
      after(0, { replacedAt: new Date() }),
    ])
      expect(await failure(asNora((tx) => tx.insert(s.contentDropFiles).values(wrong)))).toMatch(
        /row-level security|content_drop_files_redo_check/u,
      );
    expect(
      await failure(asInes((tx) => tx.insert(s.contentDropFiles).values({ ...after(0), creatorId: ines }))),
    ).toMatch(/row-level security/u);
    expect(await failure(asInes((tx) => tx.insert(s.contentDropFiles).values(after(0))))).toMatch(
      /row-level security/u,
    );
    const fresh = after(0);
    await asNora((tx) => tx.insert(s.contentDropFiles).values(fresh));
    expect(await rowOf(fresh.id)).toMatchObject({ state: 'awaiting', position: 0, replacedAt: null });
    // The drop stays as it was: its receipt settles it.
    expect(await stateOf(mine.id)).toMatchObject({ state: 'ready' });

    // Out on her feed: nothing replaced any more.
    await withAdmin(test.admin.db, (tx) =>
      tx
        .update(s.contentDrops)
        .set({ exportedAt: new Date(), exportedBy: owner })
        .where(eq(s.contentDrops.id, mine.id)),
    );
    await withAdmin(test.admin.db, (tx) =>
      tx
        .update(s.contentDropFiles)
        .set({ state: 'refused', refusal: 'Photo illisible' })
        .where(eq(s.contentDropFiles.id, fresh.id)),
    );
    expect(await asNora(markReplaced(fresh.id))).toEqual([]);
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
    // A structure kept for Inès is never asked of Nora, even past the server's own check.
    const kept = randomUUID();
    await withAdmin(test.admin.db, (tx) =>
      tx.insert(s.scriptStructures).values({ id: kept, createdBy: owner, reservedCreatorId: ines }),
    );
    expect(
      await failure(
        asTeam(owner, (tx) =>
          tx.insert(s.contentRequests).values(request(owner, { category: 'script', structureId: kept })),
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
