import {
  AgencyStyleIdSchema,
  CreatorIdSchema,
  newId,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withCreatorAccount, withMember } from './client';
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
 * The agency's base style (ADR 0173): the owner alone reads, saves and activates its versions; nobody changes a text or
 * removes a version; the service role reads it for the agent. Invented people and texts only (ADR 0010).
 */
describe('the agency’s base style (ADR 0173): the owner’s alone', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const creatorUser = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);

  let next = 0;
  const style = (by: string, values: Partial<typeof s.agencyStyles.$inferInsert> = {}) => {
    next += 1;
    return {
      id: newId(AgencyStyleIdSchema),
      version: next,
      privateStyle: 'Phrase de style inventée',
      publicStyle: 'Phrase de style publique inventée',
      form: {},
      createdBy: by,
      ...values,
    };
  };
  const save = (by: string, row: ReturnType<typeof style>) =>
    withMember(test.app.db, by, (tx) => tx.insert(s.agencyStyles).values(row));
  const read = (by: string) =>
    withMember(test.app.db, by, (tx) => tx.select({ id: s.agencyStyles.id }).from(s.agencyStyles)).then(
      (rows) => rows.map((row) => row.id),
    );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.creators).values({
        id: nora,
        nameKey: nora,
        displayName: 'Créatrice Nora',
        timezone: 'Europe/Paris',
      });
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

  it('the owner alone saves a version, under his own name, never active at birth, texts bounded', async () => {
    expect(await failure(save(manager, style(manager)))).toMatch(/row-level security/u);
    expect(await failure(save(chatter, style(chatter)))).toMatch(/row-level security/u);
    expect(await failure(save(owner, style(manager)))).toMatch(/row-level security/u);
    expect(
      await failure(
        save(owner, style(owner, { isActive: true, activatedBy: owner, activatedAt: new Date() })),
      ),
    ).toMatch(/row-level security/u);
    expect(await failure(save(owner, style(owner, { privateStyle: 'x'.repeat(8_001) })))).toMatch(
      /agency_styles_private_style_check/u,
    );
    expect(await failure(save(owner, style(owner, { publicStyle: 'x'.repeat(4_001) })))).toMatch(
      /agency_styles_public_style_check/u,
    );
    expect(await failure(save(owner, style(owner, { form: [] })))).toMatch(/agency_styles_form_check/u);
    const first = style(owner);
    await save(owner, first);
    expect(await failure(save(owner, style(owner, { version: first.version })))).toMatch(
      /agency_styles_version_unique/u,
    );
    const hers = withCreatorAccount(test.app.db, creatorUser, (tx) =>
      tx.insert(s.agencyStyles).values(style(owner)),
    );
    expect(await failure(hers)).toMatch(/row-level security|permission denied/u);
  });

  it('the owner alone activates one, one at a time, and nobody changes a text or removes a version', async () => {
    const [a, b] = [style(owner), style(owner)];
    await save(owner, a);
    await save(owner, b);
    const activate = (by: string, id: string) =>
      withMember(test.app.db, by, (tx) =>
        tx
          .update(s.agencyStyles)
          .set({ isActive: true, activatedBy: by, activatedAt: new Date() })
          .where(eq(s.agencyStyles.id, id))
          .returning({ id: s.agencyStyles.id }),
      );
    expect(await activate(manager, a.id)).toEqual([]);
    expect(await activate(owner, a.id)).toEqual([{ id: a.id }]);
    expect(await failure(activate(owner, b.id))).toMatch(/agency_styles_one_active/u);
    const text = withMember(test.app.db, owner, (tx) =>
      tx.update(s.agencyStyles).set({ privateStyle: 'autre' }).where(eq(s.agencyStyles.id, a.id)),
    );
    expect(await failure(text)).toMatch(/permission denied/u);
    const removed = withMember(test.app.db, owner, (tx) =>
      tx.delete(s.agencyStyles).where(eq(s.agencyStyles.id, a.id)),
    );
    expect(await failure(removed)).toMatch(/permission denied/u);
    const truncated = withMember(test.app.db, owner, (tx) => tx.execute(sql`truncate agency_styles`));
    expect(await failure(truncated)).toMatch(/permission denied/u);
  });

  it('the owner reads them; a manager, a chatter and a creator’s account read nothing; the service role reads', async () => {
    expect(await read(owner)).not.toEqual([]);
    expect(await read(manager)).toEqual([]);
    expect(await read(chatter)).toEqual([]);
    const hers = await withCreatorAccount(test.app.db, creatorUser, (tx) =>
      tx.select({ id: s.agencyStyles.id }).from(s.agencyStyles),
    );
    expect(hers).toEqual([]);
    const active = await withAdmin(test.service.db, (tx) =>
      tx.select({ id: s.agencyStyles.id }).from(s.agencyStyles).where(eq(s.agencyStyles.isActive, true)),
    );
    expect(active).toHaveLength(1);
    const written = withAdmin(test.service.db, (tx) => tx.insert(s.agencyStyles).values(style(owner)));
    expect(await failure(written)).toMatch(/permission denied/u);
  });
});
