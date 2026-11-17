import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CreatorIdSchema,
  newId,
  RedirectLinkIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { sql } from 'drizzle-orm';
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

/** The statement of the migration that copies the links out of the channel's setting, replayed as it is written. */
function copyStatement(): string {
  const file = fileURLToPath(new URL('../migrations/0221_redirect_links.sql', import.meta.url));
  const statement = readFileSync(file, 'utf8')
    .split('--> statement-breakpoint')
    .find((part) => part.includes('INSERT INTO "redirect_links"'));
  if (statement === undefined) throw new Error('the copy statement is gone from the migration');
  return statement;
}

/**
 * Her redirect links (INS-03, ADR 0121 § 1): written by the server alone, read by her when they are on and placed,
 * read by the owner and an active manager, never by a chatter nor by another creator. Invented people, creators and
 * addresses only (ADR 0010).
 */
describe('her redirect links (INS-03): the server writes, she reads her own placed links', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const noraUser = newId(UserIdSchema);
  const inesUser = newId(UserIdSchema);
  const noraDaily = newId(RedirectLinkIdSchema);
  const noraUnplaced = newId(RedirectLinkIdSchema);
  const noraOff = newId(RedirectLinkIdSchema);
  const inesDaily = newId(RedirectLinkIdSchema);
  const copied = newId(RedirectLinkIdSchema);

  const link = (
    values: Partial<typeof s.redirectLinks.$inferInsert> & { id: string; creatorId: string },
  ) => ({
    name: `Lien ${values.id.slice(-8)}`,
    url: `https://liens.example/${values.id.slice(-8)}`,
    ...values,
  });
  const idsSeen = (rows: { id: string }[]) => rows.map((row) => row.id).sort();

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
      await tx.insert(s.redirectLinks).values([
        link({
          id: noraDaily,
          creatorId: nora,
          placement: 'story_daily',
          usageNote: 'Pour tes stories du jour',
        }),
        link({ id: noraUnplaced, creatorId: nora }),
        link({ id: noraOff, creatorId: nora, placement: 'story_highlight', enabled: false }),
        link({ id: inesDaily, creatorId: ines, placement: 'story_daily' }),
      ]);
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('she reads her own links that are on and placed, never another creator’s', async () => {
    const hers = await withCreatorAccount(test.app.db, noraUser, (tx) =>
      tx.select({ id: s.redirectLinks.id }).from(s.redirectLinks),
    );
    expect(idsSeen(hers)).toEqual([noraDaily]);
    const others = await withCreatorAccount(test.app.db, inesUser, (tx) =>
      tx.select({ id: s.redirectLinks.id }).from(s.redirectLinks),
    );
    expect(idsSeen(others)).toEqual([inesDaily]);
  });

  it('she writes nothing: no insert, no update, no delete', async () => {
    const asNora = <T>(fn: Parameters<typeof withCreatorAccount<T>>[2]) =>
      withCreatorAccount(test.app.db, noraUser, fn);
    expect(
      await failure(
        asNora((tx) =>
          tx.insert(s.redirectLinks).values(link({ id: newId(RedirectLinkIdSchema), creatorId: nora })),
        ),
      ),
    ).toMatch(/permission denied/u);
    expect(await failure(asNora((tx) => tx.update(s.redirectLinks).set({ usageNote: 'x' })))).toMatch(
      /permission denied/u,
    );
    expect(await failure(asNora((tx) => tx.delete(s.redirectLinks)))).toMatch(/permission denied/u);
  });

  it('the owner and an active manager read every link of the creator at hand, a chatter none', async () => {
    for (const userId of [owner, manager]) {
      const seen = await withTenantMember(test.app.db, nora, userId, (tx) =>
        tx.select({ id: s.redirectLinks.id }).from(s.redirectLinks),
      );
      expect(idsSeen(seen)).toEqual([noraDaily, noraUnplaced, noraOff].sort());
    }
    const none = await withTenantMember(test.app.db, nora, chatter, (tx) =>
      tx.select({ id: s.redirectLinks.id }).from(s.redirectLinks),
    );
    expect(none).toEqual([]);
    expect(
      await failure(
        withTenantMember(test.app.db, nora, owner, (tx) =>
          tx.insert(s.redirectLinks).values(link({ id: newId(RedirectLinkIdSchema), creatorId: nora })),
        ),
      ),
    ).toMatch(/permission denied/u);
  });

  it('the table refuses an address that is not https, an unknown place and a name taken twice for her', async () => {
    const insert = (values: Partial<typeof s.redirectLinks.$inferInsert>) =>
      failure(
        withAdmin(test.admin.db, (tx) =>
          tx
            .insert(s.redirectLinks)
            .values(link({ id: newId(RedirectLinkIdSchema), creatorId: nora, ...values })),
        ),
      );
    expect(await insert({ url: 'http://liens.example/x' })).toMatch(/redirect_links_url_check/u);
    expect(await insert({ placement: 'bio' })).toMatch(/redirect_links_placement_check/u);
    expect(await insert({ name: `Lien ${noraDaily.slice(-8)}` })).toMatch(
      /redirect_links_creator_name_unique/u,
    );
  });

  it('the migration’s copy takes the links of the channel’s setting with their identifiers, and replays to nothing', async () => {
    await withAdmin(test.admin.db, (tx) =>
      tx.insert(s.telegramChannels).values({
        creatorId: ines,
        config: {
          links: [
            { id: copied, name: ' Canal ', url: 'https://liens.example/canal', destination: 'mon canal' },
            { id: newId(RedirectLinkIdSchema), name: 'Sans https', url: 'http://liens.example/non' },
            { id: 'pas-un-uuid', name: 'Identifiant faux', url: 'https://liens.example/faux' },
          ],
        },
      }),
    );
    const run = () => test.admin.db.execute(sql.raw(copyStatement()));
    await run();
    await run();
    const rows = await withAdmin(test.admin.db, (tx) =>
      tx
        .select()
        .from(s.redirectLinks)
        .where(sql`${s.redirectLinks.creatorId} = ${ines}`),
    );
    const canal = rows.find((row) => row.id === copied);
    expect(rows.map((row) => row.id).sort()).toEqual([copied, inesDaily].sort());
    expect(canal).toMatchObject({
      name: 'Canal',
      url: 'https://liens.example/canal',
      destination: 'mon canal',
      placement: null,
      usageNote: '',
      enabled: true,
    });
  });
});
