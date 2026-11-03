import {
  AvailabilityIdSchema,
  CreatorIdSchema,
  CreatorTaskIdSchema,
  newId,
  SuggestionIdSchema,
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
 * Her agenda's tables (CR-05, migration 0103): her tasks, ticks and dispos are hers, the owner and an active manager
 * read them; a suggestion is the agency's, which she reads and decides. A chatter reads none of it. Invented people and
 * creators only (ADR 0010).
 */
describe('her agenda’s tables (CR-05): hers to write, the agency’s to read and suggest', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraUser = newId(UserIdSchema);
  const inesUser = newId(UserIdSchema);
  const noraTask = newId(CreatorTaskIdSchema);
  const inesTask = newId(CreatorTaskIdSchema);

  const task = (creatorId: string, by: string, values: Partial<typeof s.creatorTasks.$inferInsert> = {}) => ({
    id: newId(CreatorTaskIdSchema),
    creatorId,
    kind: 'day',
    category: 'shoot',
    title: 'Tournage lingerie',
    day: '2026-11-05',
    createdBy: by,
    ...values,
  });
  const suggestion = (by: string, values: Partial<typeof s.creatorSuggestions.$inferInsert> = {}) => ({
    id: newId(SuggestionIdSchema),
    creatorId: nora,
    origin: 'agency',
    kind: 'day',
    category: 'post',
    title: 'Story du matin',
    day: '2026-11-05',
    week: '2026-11-02',
    createdBy: by,
    ...values,
  });
  const asNora = <T>(fn: Parameters<typeof withCreatorAccount<T>>[2]) =>
    withCreatorAccount(test.app.db, noraUser, fn);

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
    });
    await asNora((tx) => tx.insert(s.creatorTasks).values(task(nora, noraUser, { id: noraTask })));
    await withCreatorAccount(test.app.db, inesUser, (tx) =>
      tx.insert(s.creatorTasks).values(task(ines, inesUser, { id: inesTask })),
    );
  });

  afterAll(async () => {
    await test.close();
  });

  it('she writes and reads her own tasks, never another creator’s, nor under another name', async () => {
    const seen = await asNora((tx) => tx.select({ id: s.creatorTasks.id }).from(s.creatorTasks));
    expect(seen.map((row) => row.id)).toEqual([noraTask]);
    expect(await failure(asNora((tx) => tx.insert(s.creatorTasks).values(task(ines, noraUser))))).toMatch(
      /row-level security/u,
    );
    expect(await failure(asNora((tx) => tx.insert(s.creatorTasks).values(task(nora, owner))))).toMatch(
      /row-level security/u,
    );
    const moved = await asNora((tx) =>
      tx.update(s.creatorTasks).set({ day: '2026-11-06' }).where(eq(s.creatorTasks.id, inesTask)).returning(),
    );
    expect(moved).toEqual([]);
  });

  it('she never makes a task essential, and never deletes one', async () => {
    expect(
      await failure(
        asNora((tx) =>
          tx.update(s.creatorTasks).set({ essential: true }).where(eq(s.creatorTasks.id, noraTask)),
        ),
      ),
    ).toMatch(/permission denied/u);
    expect(
      await failure(asNora((tx) => tx.delete(s.creatorTasks).where(eq(s.creatorTasks.id, noraTask)))),
    ).toMatch(/permission denied/u);
  });

  it('ticks once per task and day, only on a task of hers, and takes a tick back', async () => {
    const tick = {
      taskId: noraTask,
      creatorId: nora,
      day: '2026-11-05',
      doneAt: new Date(),
      createdBy: noraUser,
    };
    await asNora((tx) => tx.insert(s.creatorTaskTicks).values(tick));
    expect(await failure(asNora((tx) => tx.insert(s.creatorTaskTicks).values(tick)))).toMatch(
      /creator_task_ticks_unique/u,
    );
    // Her creator on another creator's task: the pair (task, creator) does not exist.
    expect(
      await failure(asNora((tx) => tx.insert(s.creatorTaskTicks).values({ ...tick, taskId: inesTask }))),
    ).toMatch(/creator_task_ticks_task_fk/u);
    const removed = await asNora((tx) =>
      tx.delete(s.creatorTaskTicks).where(eq(s.creatorTaskTicks.taskId, noraTask)).returning(),
    );
    expect(removed).toHaveLength(1);
  });

  it('keeps a weekly dispo in minutes of her day, the end of a night the next day’s', async () => {
    const night = {
      id: newId(AvailabilityIdSchema),
      creatorId: nora,
      kind: 'weekly',
      weekday: 6,
      startMinute: 22 * 60,
      endMinute: 2 * 60,
      createdBy: noraUser,
    };
    await asNora((tx) => tx.insert(s.creatorAvailabilities).values(night));
    expect(
      await failure(
        asNora((tx) =>
          tx
            .insert(s.creatorAvailabilities)
            .values({ ...night, id: newId(AvailabilityIdSchema), endMinute: 26 * 60 }),
        ),
      ),
    ).toMatch(/creator_availabilities_when_check/u);
  });

  it('the owner and an active manager read her agenda and suggest; a chatter does neither', async () => {
    for (const reader of [owner, manager]) {
      const rows = await withTenantMember(test.app.db, nora, reader, (tx) =>
        tx.select({ id: s.creatorTasks.id }).from(s.creatorTasks),
      );
      expect(rows.map((row) => row.id)).toEqual([noraTask]);
    }
    expect(
      await withTenantMember(test.app.db, nora, chatter, (tx) => tx.select().from(s.creatorTasks)),
    ).toEqual([]);
    await withTenantMember(test.app.db, nora, manager, (tx) =>
      tx.insert(s.creatorSuggestions).values(suggestion(manager)),
    );
    expect(
      await failure(
        withTenantMember(test.app.db, nora, chatter, (tx) =>
          tx.insert(s.creatorSuggestions).values(suggestion(chatter)),
        ),
      ),
    ).toMatch(/row-level security/u);
    // An agency suggestion carries its author; the AI's comes from a job.
    expect(
      await failure(
        withTenantMember(test.app.db, nora, owner, (tx) =>
          tx.insert(s.creatorSuggestions).values(suggestion(owner, { origin: 'ai' })),
        ),
      ),
    ).toMatch(/row-level security|creator_suggestions_author_check/u);
    // The agency never writes her tasks.
    expect(
      await failure(
        withTenantMember(test.app.db, nora, owner, (tx) =>
          tx.insert(s.creatorTasks).values(task(nora, owner)),
        ),
      ),
    ).toMatch(/row-level security/u);
  });

  it('she decides a suggestion, never rewrites what it proposes', async () => {
    const id = newId(SuggestionIdSchema);
    await withTenantMember(test.app.db, nora, owner, (tx) =>
      tx.insert(s.creatorSuggestions).values(suggestion(owner, { id })),
    );
    expect(
      await failure(
        asNora((tx) =>
          tx.update(s.creatorSuggestions).set({ title: 'Autre' }).where(eq(s.creatorSuggestions.id, id)),
        ),
      ),
    ).toMatch(/permission denied/u);
    const declined = await asNora((tx) =>
      tx
        .update(s.creatorSuggestions)
        .set({
          state: 'declined',
          reason: 'Pas cette semaine',
          decidedAt: new Date(),
          decidedOn: '2026-11-03',
        })
        .where(eq(s.creatorSuggestions.id, id))
        .returning({ state: s.creatorSuggestions.state }),
    );
    expect(declined).toEqual([{ state: 'declined' }]);
    // Inès reads none of Nora's suggestions.
    expect(
      await withCreatorAccount(test.app.db, inesUser, (tx) => tx.select().from(s.creatorSuggestions)),
    ).toEqual([]);
  });
});
