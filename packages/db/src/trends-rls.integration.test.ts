import {
  ContentIdeaIdSchema,
  CreatorIdSchema,
  ExtensionLinkIdSchema,
  newId,
  TeamMemberIdSchema,
  TrendReadingIdSchema,
  TrendSignalIdSchema,
  UserIdSchema,
  WatchSessionIdSchema,
} from '@nirvana/contracts';
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
 * The trend watch's tables (VEI-01, ADR 0060): the owner and an active manager read and decide; a chatter pastes a link
 * and reads nothing; the creator pastes a link of hers, watches for herself, and reads neither a signal nor an idea.
 * Invented people, creators, accounts and posts only (ADR 0010).
 */
describe('the trend watch’s tables (VEI-01): the agency’s, never the creator’s', () => {
  let test: TestDb;
  const owner = newId(UserIdSchema);
  const manager = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const creatorUser = newId(UserIdSchema);
  const nora = newId(CreatorIdSchema);
  const ines = newId(CreatorIdSchema);
  const global = newId(TrendSignalIdSchema);
  const hers = newId(TrendSignalIdSchema);
  const observedAt = new Date('2026-11-03T08:00:00.000Z');
  const expiresAt = new Date('2026-11-17T08:00:00.000Z');

  const link = (by: string, values: Partial<typeof s.trendSignals.$inferInsert> = {}) => ({
    id: newId(TrendSignalIdSchema),
    creatorId: nora,
    source: 'agency_link',
    kind: 'format',
    text: 'Transition miroir',
    url: `https://www.instagram.com/reel/Code${by.slice(-6).replaceAll('-', '')}/`,
    format: 'reel',
    createdBy: by,
    observedAt,
    expiresAt,
    ...values,
  });
  const signalsSeen = (by: string, creatorId = nora) =>
    withTenantMember(test.app.db, creatorId, by, (tx) =>
      tx.select({ id: s.trendSignals.id }).from(s.trendSignals),
    ).then((rows) => rows.map((row) => row.id).sort());
  const idea = (values: Partial<typeof s.contentIdeas.$inferInsert> = {}) => ({
    id: newId(ContentIdeaIdSchema),
    creatorId: nora,
    signalId: hers,
    title: 'Transition miroir avant sortie',
    category: 'instagram_reel',
    toShoot: 'Deux plans devant le miroir.',
    reason: 'Le format monte.',
    shootMinutes: 20,
    proposedOn: '2026-11-03',
    ...values,
  });
  const reading = (by: string, values: Partial<typeof s.trendReadings.$inferInsert> = {}) => ({
    id: newId(TrendReadingIdSchema),
    recordedBy: by,
    watchSessionId: newId(WatchSessionIdSchema),
    postCode: 'AbC123xyz',
    path: 'reel',
    account: 'compte.invente',
    views: 1_000,
    dwellMs: 4_000,
    firstSeenAt: observedAt,
    seenAt: observedAt,
    ...values,
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
      await tx.insert(s.user).values({
        id: creatorUser,
        name: 'Nora',
        email: 'nora@example.test',
        role: 'creator',
        creatorIds: [nora],
      });
      // The jobs write the agency's signals and the morning ideas.
      await tx.insert(s.trendSignals).values([
        {
          id: global,
          creatorId: null,
          source: 'grok_search',
          kind: 'sound',
          text: 'Un son monte',
          observedAt,
          expiresAt,
        },
        {
          id: hers,
          creatorId: nora,
          source: 'creator_stats',
          kind: 'format',
          text: 'Ses Reels courts',
          observedAt,
          expiresAt,
        },
      ]);
      await tx.insert(s.contentIdeas).values(idea());
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('the owner and an active manager read her signals and the agency’s; a chatter reads none', async () => {
    const expected = [global, hers].sort();
    expect(await signalsSeen(owner)).toEqual(expected);
    expect(await signalsSeen(manager)).toEqual(expected);
    expect(await signalsSeen(chatter)).toEqual([]);
    // Under Inès, Nora's signal is out of sight.
    expect(await signalsSeen(owner, ines)).toEqual([global]);
  });

  it('a member pastes a link for the creator of his transaction, under his own name, once', async () => {
    const pasted = link(chatter);
    await withTenantMember(test.app.db, nora, chatter, (tx) => tx.insert(s.trendSignals).values(pasted));
    expect(
      await failure(
        withTenantMember(test.app.db, nora, chatter, (tx) =>
          tx
            .insert(s.trendSignals)
            .values(link(chatter, { id: newId(TrendSignalIdSchema), url: pasted.url })),
        ),
      ),
    ).toMatch(/trend_signals_link_unique/u);
    for (const values of [
      { createdBy: owner },
      { creatorId: ines },
      { source: 'grok_search' },
      { source: 'creator_link' },
    ])
      expect(
        await failure(
          withTenantMember(test.app.db, nora, chatter, (tx) =>
            tx.insert(s.trendSignals).values(link(chatter, values)),
          ),
        ),
        JSON.stringify(values),
      ).toMatch(/row-level security/u);
    expect(await signalsSeen(owner)).toContain(pasted.id);
  });

  it('the creator pastes a link of hers and reads neither a signal nor an idea', async () => {
    const asHer = <T>(fn: Parameters<typeof withCreatorAccount<T>>[2]) =>
      withCreatorAccount(test.app.db, creatorUser, fn);
    await asHer((tx) =>
      tx
        .insert(s.trendSignals)
        .values(link(creatorUser, { source: 'creator_link', url: 'https://www.instagram.com/p/HerCode1/' })),
    );
    expect(await asHer((tx) => tx.select().from(s.trendSignals))).toEqual([]);
    expect(await asHer((tx) => tx.select().from(s.contentIdeas))).toEqual([]);
    for (const values of [{ source: 'agency_link' }, { creatorId: ines }, { createdBy: owner }])
      expect(
        await failure(
          asHer((tx) =>
            tx.insert(s.trendSignals).values(link(creatorUser, { source: 'creator_link', ...values })),
          ),
        ),
        JSON.stringify(values),
      ).toMatch(/row-level security/u);
    expect(await failure(asHer((tx) => tx.insert(s.contentIdeas).values(idea())))).toMatch(
      /row-level security/u,
    );
  });

  it('nobody but the jobs changes or removes a signal', async () => {
    const changed = withTenantMember(test.app.db, nora, owner, (tx) =>
      tx.update(s.trendSignals).set({ text: 'Autre' }).where(eq(s.trendSignals.id, hers)),
    );
    expect(await failure(changed)).toMatch(/permission denied/u);
    const removed = withTenantMember(test.app.db, nora, owner, (tx) =>
      tx.delete(s.trendSignals).where(eq(s.trendSignals.id, hers)),
    );
    expect(await failure(removed)).toMatch(/permission denied/u);
  });

  it('the owner and an active manager decide the ideas; a chatter neither reads nor writes one', async () => {
    const seen = (by: string) =>
      withTenantMember(test.app.db, nora, by, (tx) =>
        tx.select({ id: s.contentIdeas.id }).from(s.contentIdeas),
      );
    expect(await seen(owner)).toHaveLength(1);
    expect(await seen(manager)).toHaveLength(1);
    expect(await seen(chatter)).toEqual([]);
    const refused = await withTenantMember(test.app.db, nora, manager, (tx) =>
      tx
        .update(s.contentIdeas)
        .set({ state: 'refused', refusalReason: 'Déjà fait', decidedBy: manager, decidedAt: new Date() })
        .returning({ id: s.contentIdeas.id }),
    );
    expect(refused).toHaveLength(1);
    expect(
      await failure(
        withTenantMember(test.app.db, nora, chatter, (tx) => tx.insert(s.contentIdeas).values(idea())),
      ),
    ).toMatch(/row-level security/u);
    // A reason belongs to a refusal only.
    expect(
      await failure(
        withTenantMember(test.app.db, nora, owner, (tx) =>
          tx.insert(s.contentIdeas).values(idea({ refusalReason: 'Non' })),
        ),
      ),
    ).toMatch(/content_ideas_refusal_check/u);
    // Her « no » in her agenda reaches the idea by the agenda's event, written by a job; it carries no agency reason.
    const hersDeclined = idea();
    await withAdmin(test.admin.db, (tx) =>
      tx.insert(s.contentIdeas).values({ ...hersDeclined, state: 'declined', decidedAt: new Date() }),
    );
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx
            .insert(s.contentIdeas)
            .values(idea({ state: 'declined', decidedAt: new Date(), refusalReason: 'Non' })),
        ),
      ),
    ).toMatch(/content_ideas_refusal_check/u);
  });

  it('a reading is its watcher’s, read by the owner and an active manager; the creator marks for herself only', async () => {
    const session = newId(WatchSessionIdSchema);
    const mine = reading(chatter, { watchSessionId: session });
    await withTenantMember(test.app.db, nora, chatter, (tx) => tx.insert(s.trendReadings).values(mine));
    // Seen again in the same session, by another path: the figures move, no new row.
    await withTenantMember(test.app.db, nora, chatter, (tx) =>
      tx
        .insert(s.trendReadings)
        .values(reading(chatter, { watchSessionId: session, path: 'post', views: 1_500 }))
        .onConflictDoUpdate({
          target: [s.trendReadings.recordedBy, s.trendReadings.watchSessionId, s.trendReadings.postCode],
          set: { views: sql`excluded.views`, seenAt: sql`excluded.seen_at` },
        }),
    );
    const all = await withTenantMember(test.app.db, nora, manager, (tx) =>
      tx.select({ views: s.trendReadings.views }).from(s.trendReadings),
    );
    expect(all).toEqual([{ views: 1_500 }]);
    // A sound is kept by its number only.
    expect(
      await failure(
        withTenantMember(test.app.db, nora, chatter, (tx) =>
          tx.insert(s.trendReadings).values(reading(chatter, { soundId: 'son-invente' })),
        ),
      ),
    ).toMatch(/trend_readings_sound_id_check/u);
    expect(
      await failure(
        withTenantMember(test.app.db, nora, chatter, (tx) =>
          tx.insert(s.trendReadings).values(reading(manager)),
        ),
      ),
    ).toMatch(/row-level security/u);

    const asHer = <T>(fn: Parameters<typeof withCreatorAccount<T>>[2]) =>
      withCreatorAccount(test.app.db, creatorUser, fn);
    await asHer((tx) => tx.insert(s.trendReadings).values(reading(creatorUser, { markedFor: nora })));
    expect(await asHer((tx) => tx.select({ by: s.trendReadings.recordedBy }).from(s.trendReadings))).toEqual([
      { by: creatorUser },
    ]);
    expect(
      await failure(
        asHer((tx) => tx.insert(s.trendReadings).values(reading(creatorUser, { markedFor: ines }))),
      ),
    ).toMatch(/row-level security/u);
  });

  it('the extension’s links are out of the application’s reach', async () => {
    const row = { id: newId(ExtensionLinkIdSchema), userId: chatter, tokenHash: 'hash-invente' };
    await withAdmin(test.admin.db, (tx) => tx.insert(s.extensionLinks).values(row));
    expect(
      await failure(withTenantMember(test.app.db, nora, owner, (tx) => tx.select().from(s.extensionLinks))),
    ).toMatch(/permission denied/u);
  });
});
