import {
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { withAdmin, withCreatorAccount, withTenant } from './client';
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
 * His kept language (ADR 0168 § 3, migration 0273): read and written in his creator only, never by a creator account,
 * whole or absent, a person's name exactly when a person set it. Invented creators and fans only (ADR 0010).
 */
describe('the fan’s kept language (ADR 0168): his creator’s, whole, and the person who set it', () => {
  let test: TestDb;
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraFan = newId(FanIdSchema);
  const inesFan = newId(FanIdSchema);
  const owner = newId(UserIdSchema);
  const noraUser = newId(UserIdSchema);
  const at = new Date('2026-11-26T10:00:00Z');

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    await withAdmin(test.admin.db, async (tx) => {
      for (const [label, creatorId, fanId] of [
        ['Nora', nora, noraFan],
        ['Inès', ines, inesFan],
      ] as const) {
        const accountId = newId(PlatformAccountIdSchema);
        await tx.insert(s.creators).values({
          id: creatorId,
          nameKey: creatorId,
          displayName: `Créatrice ${label}`,
          timezone: 'Europe/Paris',
        });
        await tx
          .insert(s.platformAccounts)
          .values({ id: accountId, creatorId, platform: 'reveal', handle: `handle-${label}` });
        await tx.insert(s.fans).values({
          id: fanId,
          creatorId,
          platformAccountId: accountId,
          platformFanId: 'fan-1',
          displayName: 'Fan inventé',
        });
      }
      await tx
        .insert(s.user)
        .values({ id: owner, name: 'Compte owner', email: `${owner}@example.test`, role: 'owner' });
      await tx.insert(s.user).values({
        id: noraUser,
        name: 'Nora',
        email: `${noraUser}@example.test`,
        role: 'creator',
        creatorIds: [nora],
      });
    });
  }, 120_000);

  afterAll(async () => {
    await test.close();
  });

  it('is written in his creator only, and read in hers only', async () => {
    await withTenant(test.app.db, nora, (tx) =>
      tx
        .update(s.fans)
        .set({ language: 'italian', languageSource: 'detected', languageSetAt: at })
        .where(eq(s.fans.id, noraFan)),
    );
    // Nora's tenant does not see Inès's fan: the update changes nothing.
    const touched = await withTenant(test.app.db, nora, (tx) =>
      tx
        .update(s.fans)
        .set({ language: 'english', languageSource: 'detected', languageSetAt: at })
        .where(eq(s.fans.id, inesFan))
        .returning({ id: s.fans.id }),
    );
    expect(touched).toEqual([]);
    const seen = await withTenant(test.app.db, ines, (tx) =>
      tx.select({ id: s.fans.id, language: s.fans.language }).from(s.fans),
    );
    expect(seen).toEqual([{ id: inesFan, language: null }]);
    const hers = await withTenant(test.app.db, nora, (tx) =>
      tx.select({ language: s.fans.language }).from(s.fans).where(eq(s.fans.id, noraFan)),
    );
    expect(hers).toEqual([{ language: 'italian' }]);
  });

  it('is never written by a creator account', async () => {
    const changed = await withCreatorAccount(test.app.db, noraUser, (tx) =>
      tx
        .update(s.fans)
        .set({ language: 'french', languageSource: 'detected', languageSetAt: at })
        .where(eq(s.fans.id, noraFan))
        .returning({ id: s.fans.id }),
    );
    expect(changed).toEqual([]);
  });

  it('is whole or absent, with a person exactly when a person set it, and a language of the list', async () => {
    const write = (values: Partial<typeof s.fans.$inferInsert>) =>
      withTenant(test.app.db, nora, (tx) => tx.update(s.fans).set(values).where(eq(s.fans.id, noraFan)));
    expect(
      await failure(write({ language: 'klingon', languageSource: 'detected', languageSetAt: at })),
    ).toMatch(/fans_language_check/u);
    expect(await failure(write({ language: 'french', languageSource: null, languageSetAt: at }))).toMatch(
      /fans_language_whole_check/u,
    );
    expect(await failure(write({ language: 'french', languageSource: 'set', languageSetAt: at }))).toMatch(
      /fans_language_whole_check/u,
    );
    expect(
      await failure(
        write({ language: 'french', languageSource: 'detected', languageSetBy: owner, languageSetAt: at }),
      ),
    ).toMatch(/fans_language_whole_check/u);
    await write({ language: 'french', languageSource: 'set', languageSetBy: owner, languageSetAt: at });
    const [row] = await withTenant(test.app.db, nora, (tx) =>
      tx
        .select({ source: s.fans.languageSource, setBy: s.fans.languageSetBy })
        .from(s.fans)
        .where(eq(s.fans.id, noraFan)),
    );
    expect(row).toEqual({ source: 'set', setBy: owner });
  });
});
