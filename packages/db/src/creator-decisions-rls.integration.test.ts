import {
  CreatorDecisionIdSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withCreatorAccount, withTenant, withTenantJob, withTenantMember } from './client';
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
 * « À décider », hers (ADR 0162): the code that asks writes, she reads and answers her own, the owner answers in her
 * place, nobody else reads. Invented people and creators only (ADR 0010).
 */
describe('her decisions (ADR 0162): asked by the code, answered by her or by the owner, once', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraUser = newId(UserIdSchema);
  const inesUser = newId(UserIdSchema);
  const noraCaption = newId(CreatorDecisionIdSchema);
  const noraTime = newId(CreatorDecisionIdSchema);
  const inesCaption = newId(CreatorDecisionIdSchema);

  const d = s.creatorDecisions;
  const row = (id: string, creatorId: string, kind = 'caption') => ({
    id,
    creatorId,
    kind,
    subject: `reel:${id}`,
    category: 'post',
    question: 'Quelle légende ?',
    context: 'Un Reel inventé.',
    layout: 'buttons',
    answers: [
      { key: 'yes', label: 'Oui', text: null, noted: 'C’est noté.' },
      { key: 'no', label: 'Non', text: null, noted: 'C’est noté.' },
    ],
    expiresAt: new Date('2026-12-01T00:00:00Z'),
  });
  const asking = <T>(creatorId: string, fn: Parameters<typeof withTenantJob<T>>[3]) =>
    withTenantJob(test.app.db, creatorId, 'creator_decisions', fn);
  const idsSeen = (rows: { id: string }[]) => rows.map((one) => one.id).sort();
  const all = { id: d.id };
  const answer = (userId: string) => ({
    state: 'answered',
    answerKey: 'yes',
    answeredAt: new Date('2026-11-21T10:00:00Z'),
    answeredBy: userId,
  });

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
      await tx
        .update(s.user)
        .set({ creatorIds: [nora, ines] })
        .where(eq(s.user.id, manager));
    });
  }, 120_000);

  afterAll(async () => {
    await test.close();
  });

  it('the code that asks writes in the creator it asks for, once per subject, and under its own name only', async () => {
    await asking(nora, (tx) =>
      tx.insert(d).values([row(noraCaption, nora), row(noraTime, nora, 'publish_time')]),
    );
    await asking(ines, (tx) => tx.insert(d).values(row(inesCaption, ines)));
    expect(
      await failure(asking(nora, (tx) => tx.insert(d).values(row(newId(CreatorDecisionIdSchema), ines)))),
    ).toMatch(/row-level security/u);
    expect(
      await failure(
        withTenant(test.app.db, nora, (tx) => tx.insert(d).values(row(newId(CreatorDecisionIdSchema), nora))),
      ),
    ).toMatch(/row-level security/u);
    expect(
      await failure(
        asking(nora, (tx) =>
          tx
            .insert(d)
            .values({ ...row(newId(CreatorDecisionIdSchema), nora), subject: `reel:${noraCaption}` }),
        ),
      ),
    ).toMatch(/creator_decisions_subject_unique/u);
    expect(idsSeen(await asking(nora, (tx) => tx.select(all).from(d)))).toEqual(
      [noraCaption, noraTime].sort(),
    );
  });

  it('she reads her own, the owner reads the creator at hand, a manager and a chatter read none', async () => {
    expect(idsSeen(await withCreatorAccount(test.app.db, noraUser, (tx) => tx.select(all).from(d)))).toEqual(
      [noraCaption, noraTime].sort(),
    );
    expect(idsSeen(await withCreatorAccount(test.app.db, inesUser, (tx) => tx.select(all).from(d)))).toEqual([
      inesCaption,
    ]);
    expect(idsSeen(await withTenantMember(test.app.db, ines, owner, (tx) => tx.select(all).from(d)))).toEqual(
      [inesCaption],
    );
    for (const member of [manager, chatter])
      expect(await withTenantMember(test.app.db, nora, member, (tx) => tx.select(all).from(d))).toEqual([]);
    expect(await withTenant(test.app.db, nora, (tx) => tx.select(all).from(d))).toEqual([]);
  });

  it('she answers her own, once; another creator, a manager and a chatter answer nothing', async () => {
    const set = (values: object) => (tx: Parameters<Parameters<typeof withAdmin>[1]>[0]) =>
      tx.update(d).set(values).returning(all);
    expect(await withCreatorAccount(test.app.db, inesUser, set(answer(inesUser)))).toEqual([
      { id: inesCaption },
    ]);
    for (const member of [manager, chatter])
      expect(await withTenantMember(test.app.db, nora, member, set(answer(member)))).toEqual([]);
    expect(
      await withCreatorAccount(test.app.db, noraUser, (tx) =>
        tx.update(d).set(answer(noraUser)).where(eq(d.id, noraCaption)).returning(all),
      ),
    ).toEqual([{ id: noraCaption }]);
    // Answered: no policy opens the row again, for her nor for the owner nor for who asked.
    expect(
      await withCreatorAccount(test.app.db, noraUser, (tx) =>
        tx.update(d).set({ answerKey: 'no' }).where(eq(d.id, noraCaption)).returning(all),
      ),
    ).toEqual([]);
    expect(
      await withTenantMember(test.app.db, nora, owner, (tx) =>
        tx.update(d).set({ answerKey: 'no' }).where(eq(d.id, noraCaption)).returning(all),
      ),
    ).toEqual([]);
    expect(
      await asking(nora, (tx) =>
        tx.update(d).set({ state: 'withdrawn' }).where(eq(d.id, noraCaption)).returning(all),
      ),
    ).toEqual([]);
  });

  it('the owner answers in her place, in the creator at hand; who asked only withdraws', async () => {
    expect(await failure(asking(nora, (tx) => tx.update(d).set(answer(owner))))).toMatch(
      /row-level security/u,
    );
    expect(
      await withTenantMember(test.app.db, nora, owner, (tx) =>
        tx.update(d).set(answer(owner)).returning(all),
      ),
    ).toEqual([{ id: noraTime }]);
    const other = newId(CreatorDecisionIdSchema);
    await asking(nora, (tx) => tx.insert(d).values(row(other, nora, 'trial_reel')));
    expect(await asking(nora, (tx) => tx.update(d).set({ state: 'withdrawn' }).returning(all))).toEqual([
      { id: other },
    ]);
  });

  it('nobody rewrites a question nor removes a decision, and an answer is whole or absent', async () => {
    const fresh = newId(CreatorDecisionIdSchema);
    await asking(nora, (tx) =>
      tx.insert(d).values({ ...row(fresh, nora), subject: `reel:${fresh}`, kind: 'trial_reel' }),
    );
    for (const run of [
      () => withCreatorAccount(test.app.db, noraUser, (tx) => tx.update(d).set({ question: 'Autre ?' })),
      () => withTenantMember(test.app.db, nora, owner, (tx) => tx.update(d).set({ answers: [] })),
      () => asking(nora, (tx) => tx.update(d).set({ expiresAt: new Date() })),
      () => withCreatorAccount(test.app.db, noraUser, (tx) => tx.delete(d)),
      () => asking(nora, (tx) => tx.delete(d)),
    ])
      expect(await failure(run())).toMatch(/permission denied/u);
    expect(
      await failure(
        withCreatorAccount(test.app.db, noraUser, (tx) => tx.update(d).set({ state: 'answered' })),
      ),
    ).toMatch(/creator_decisions_answered_check/u);
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx.insert(d).values({ ...row(newId(CreatorDecisionIdSchema), nora), answers: [] }),
        ),
      ),
    ).toMatch(/creator_decisions_answers_check|permission denied/u);
  });
});
