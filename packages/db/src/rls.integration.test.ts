import {
  ConversationIdSchema,
  CreatorIdSchema,
  DraftIdSchema,
  FanIdSchema,
  MediaAssetIdSchema,
  MessageIdSchema,
  newId,
  PersonaVersionIdSchema,
  PlatformAccountIdSchema,
} from '@nirvana/contracts';
import { eq, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { SNAPSHOT_READ, withAdmin, withTenant, type Database } from './client';
import { MIGRATIONS_FOLDER, migrationStatus, runMigrations } from './migrate';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

/** Every migration in the journal, so that adding one does not break these tests. */
const SHIPPED_MIGRATIONS = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length;

const at = new Date('2026-10-17T12:00:00Z');

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

/** One row in every tenant table for a creator; invented data only. */
async function seedCreator(admin: Database, label: string) {
  const creatorId = newId(CreatorIdSchema);
  const accountId = newId(PlatformAccountIdSchema);
  const fanId = newId(FanIdSchema);
  const conversationId = newId(ConversationIdSchema);
  const messageId = newId(MessageIdSchema);
  const draftId = newId(DraftIdSchema);
  const personaId = newId(PersonaVersionIdSchema);
  const mediaId = newId(MediaAssetIdSchema);
  await withAdmin(admin, async (tx) => {
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
      displayName: 'Fan test',
    });
    await tx.insert(s.conversations).values({
      id: conversationId,
      creatorId,
      platformAccountId: accountId,
      fanId,
      platformConversationId: 'conv-1',
    });
    await tx.insert(s.personaVersions).values({
      id: personaId,
      creatorId,
      version: '0.0.0',
      sourcePath: 'personas/demo/v0.1.0.yaml',
      content: {},
      contentHash: 'h',
    });
    await tx.insert(s.drafts).values({
      id: draftId,
      creatorId,
      conversationId,
      personaVersionId: personaId,
      idempotencyKey: `draft-${label}`,
    });
    await tx.insert(s.messages).values({
      id: messageId,
      creatorId,
      platformAccountId: accountId,
      conversationId,
      platformMessageId: 'msg-1',
      direction: 'inbound',
      author: 'fan',
      text: 'Salut',
      platformCreatedAt: at,
    });
    await tx.insert(s.conversationEvents).values({
      id: newId(MessageIdSchema),
      creatorId,
      conversationId,
      seq: 1,
      type: 'message_received',
      payload: {},
      actor: 'fan',
      correlationId: 'c',
    });
    await tx.insert(s.domainEvents).values({
      id: newId(MessageIdSchema),
      creatorId,
      type: 'mode_changed',
      payload: {},
      actor: 'system',
      correlationId: 'c',
    });
    await tx.insert(s.fanFacts).values({
      id: newId(MessageIdSchema),
      creatorId,
      fanId,
      category: 'identity',
      key: 'city',
      value: 'Ville inventée',
      kind: 'declared',
      confidence: 0.9,
      sourceMessageId: messageId,
      observedAt: at,
    });
    await tx.insert(s.fanSummaries).values({
      id: newId(MessageIdSchema),
      creatorId,
      fanId,
      version: 1,
      content: 'Résumé inventé',
      basedOnMessageId: messageId,
    });
    await tx.insert(s.mediaAssets).values({
      id: mediaId,
      creatorId,
      kind: 'image',
      origin: 'creator',
      storageKey: `k-${label}`,
      mime: 'image/jpeg',
      bytes: 10,
      sha256: `sha-${label}`,
    });
    await tx.insert(s.mediaDescriptions).values({
      id: newId(MessageIdSchema),
      creatorId,
      mediaAssetId: mediaId,
      vocabularyVersion: '1',
      content: {},
      model: 'm',
      promptHash: 'p',
    });
    await tx.insert(s.mediaSends).values({
      id: newId(MessageIdSchema),
      creatorId,
      mediaAssetId: mediaId,
      fanId,
      conversationId,
      messageId,
      priceMinor: 1500,
      currency: 'EUR',
      sentAt: at,
    });
    await tx.insert(s.llmCalls).values({
      id: newId(MessageIdSchema),
      creatorId,
      role: 'voice',
      provider: 'xai',
      model: 'm',
      promptHash: 'p',
      latencyMs: 5,
      status: 'ok',
      conversationId,
      draftId,
    });
    await tx.insert(s.calibrationRatings).values({
      id: newId(MessageIdSchema),
      creatorId,
      sessionId: 'session',
      ratedAt: at,
      voicePrompt: 'voice@1',
      voiceModel: 'model',
      verdictKind: 'corrected',
      verdict: { kind: 'corrected', text: 'Coucou' },
      destination: 'voice_example',
      fanMessage: 'Salut',
      bubbles: ['Salut toi'],
      moment: { history: [] },
    });
    await tx.insert(s.blindTests).values({
      id: newId(MessageIdSchema),
      creatorId,
      voicePrompt: 'voice@1',
      voiceModel: 'model',
      ratePerMille: 820,
      recordedBy: 'human:u',
    });
    await tx
      .insert(s.notifications)
      .values({ id: newId(MessageIdSchema), creatorId, userId: 'u', type: 'sale' });
    await tx.insert(s.killSwitches).values({
      id: newId(MessageIdSchema),
      scope: 'creator',
      scopeId: creatorId,
      creatorId,
      active: false,
      reason: 'test',
      setBy: 'u',
    });
  });
  return { creatorId, accountId, conversationId };
}

const TENANT_TABLES = {
  platform_accounts: s.platformAccounts,
  fans: s.fans,
  fan_facts: s.fanFacts,
  fan_summaries: s.fanSummaries,
  conversations: s.conversations,
  messages: s.messages,
  conversation_events: s.conversationEvents,
  domain_events: s.domainEvents,
  drafts: s.drafts,
  persona_versions: s.personaVersions,
  media_assets: s.mediaAssets,
  media_descriptions: s.mediaDescriptions,
  media_sends: s.mediaSends,
  llm_calls: s.llmCalls,
  calibration_ratings: s.calibrationRatings,
  blind_tests: s.blindTests,
  notifications: s.notifications,
  kill_switches: s.killSwitches,
};

describe('database (RLS, constraints, migrations)', () => {
  let test: TestDb;
  let a: Awaited<ReturnType<typeof seedCreator>>;
  let b: Awaited<ReturnType<typeof seedCreator>>;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    a = await seedCreator(test.admin.db, 'a');
    b = await seedCreator(test.admin.db, 'b');
    await test.admin.db
      .insert(s.killSwitches)
      .values({ id: newId(MessageIdSchema), scope: 'global', active: false, reason: 'test', setBy: 'u' });
  });

  afterAll(async () => {
    await test.close();
  });

  it.each(Object.entries(TENANT_TABLES))(
    '%s: a creator sees her rows and never another one',
    async (_, table) => {
      const seen = await withTenant(test.app.db, a.creatorId, (tx) =>
        tx.select({ creatorId: table.creatorId }).from(table),
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((row) => row.creatorId === a.creatorId || row.creatorId === null)).toBe(true);
    },
  );

  it('the global kill switch is visible to every creator', async () => {
    const rows = await withTenant(test.app.db, b.creatorId, (tx) => tx.select().from(s.killSwitches));
    expect(rows.map((r) => r.scope).sort()).toEqual(['creator', 'global']);
  });

  it('a creator reads the global kill switch but never writes, changes or removes one', async () => {
    expect(
      await failure(
        withTenant(test.app.db, a.creatorId, (tx) =>
          tx
            .insert(s.killSwitches)
            .values({ id: newId(MessageIdSchema), scope: 'global', active: true, reason: 'x', setBy: 'u' }),
        ),
      ),
    ).toMatch(/row-level security/);
    const changed = await withTenant(test.app.db, a.creatorId, (tx) =>
      tx.update(s.killSwitches).set({ active: true }).where(eq(s.killSwitches.scope, 'global')).returning(),
    );
    expect(changed).toHaveLength(0);
    const removed = await withTenant(test.app.db, a.creatorId, (tx) =>
      tx.delete(s.killSwitches).where(eq(s.killSwitches.scope, 'global')).returning(),
    );
    expect(removed).toHaveLength(0);
    const [global] = await test.admin.db
      .select()
      .from(s.killSwitches)
      .where(eq(s.killSwitches.scope, 'global'));
    expect(global?.active).toBe(false);
  });

  it('outside withTenant the app role sees zero rows, without an error', async () => {
    const setting = await test.app.db.execute(sql`select current_setting('app.creator_id', true) as value`);
    expect([null, '']).toContain(setting.rows[0]?.['value']);
    for (const table of Object.values(TENANT_TABLES).filter((t) => t !== s.killSwitches)) {
      expect(await test.app.db.select().from(table)).toHaveLength(0);
    }
  });

  it('the tenant setting does not leak to the next transaction on the same pool', async () => {
    await withTenant(test.app.db, a.creatorId, (tx) => tx.select().from(s.fans));
    expect(await test.app.db.select().from(s.fans)).toHaveLength(0);
  });

  it('a creator cannot write a row for another creator', async () => {
    expect(
      await failure(
        withTenant(test.app.db, a.creatorId, (tx) =>
          tx
            .insert(s.notifications)
            .values({ id: newId(MessageIdSchema), creatorId: b.creatorId, userId: 'u', type: 'x' }),
        ),
      ),
    ).toMatch(/row-level security/);
    const moved = await withTenant(test.app.db, a.creatorId, (tx) =>
      tx
        .update(s.conversations)
        .set({ unreadCount: 3 })
        .where(eq(s.conversations.id, b.conversationId))
        .returning(),
    );
    expect(moved).toHaveLength(0);
  });

  it('the admin role crosses tenants without being superuser', async () => {
    const role = await test.admin.db.execute(
      sql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
    );
    const fans = await withAdmin(test.admin.db, (tx) => tx.select().from(s.fans));
    expect(fans).toHaveLength(2);
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: true });
  });

  it('a platform message is stored once per account', async () => {
    expect(
      await failure(
        withTenant(test.app.db, a.creatorId, (tx) =>
          tx.insert(s.messages).values({
            id: newId(MessageIdSchema),
            creatorId: a.creatorId,
            platformAccountId: a.accountId,
            conversationId: a.conversationId,
            platformMessageId: 'msg-1',
            direction: 'inbound',
            author: 'fan',
            platformCreatedAt: at,
          }),
        ),
      ),
    ).toMatch(/messages_platform_message_unique/);
  });

  it('calibration ratings are append-only, except the purge of their moment', async () => {
    const own = eq(s.calibrationRatings.creatorId, a.creatorId);
    const asA = <T>(work: Parameters<typeof withTenant<T>>[2]) => withTenant(test.app.db, a.creatorId, work);
    expect(
      await failure(asA((tx) => tx.update(s.calibrationRatings).set({ fanMessage: 'changed' }).where(own))),
    ).toMatch(/append-only/);
    expect(
      await failure(
        asA((tx) =>
          tx
            .update(s.calibrationRatings)
            .set({ moment: null, momentPurgedAt: at, voiceModel: 'other' })
            .where(own),
        ),
      ),
    ).toMatch(/append-only/);
    expect(await failure(withAdmin(test.admin.db, (tx) => tx.delete(s.calibrationRatings)))).toMatch(
      /append-only/,
    );
    const purged = await asA((tx) =>
      tx.update(s.calibrationRatings).set({ moment: null, momentPurgedAt: at }).where(own).returning(),
    );
    expect(purged.map((row) => [row.moment, row.verdictKind])).toEqual([[null, 'corrected']]);
  });

  it('conversation events are append-only and ordered without duplicates', async () => {
    expect(
      await failure(
        withTenant(test.app.db, a.creatorId, (tx) =>
          tx
            .update(s.conversationEvents)
            .set({ correlationId: 'changed' })
            .where(eq(s.conversationEvents.creatorId, a.creatorId)),
        ),
      ),
    ).toMatch(/append-only/);
    expect(await failure(withAdmin(test.admin.db, (tx) => tx.delete(s.conversationEvents)))).toMatch(
      /append-only/,
    );
    expect(
      await failure(
        withTenant(test.app.db, a.creatorId, (tx) =>
          tx.insert(s.conversationEvents).values({
            id: newId(MessageIdSchema),
            creatorId: a.creatorId,
            conversationId: a.conversationId,
            seq: 1,
            type: 'message_sent',
            payload: {},
            actor: 'ai',
            correlationId: 'c',
          }),
        ),
      ),
    ).toMatch(/conversation_events_seq_unique/);
  });

  it('refuses a value outside a closed list', async () => {
    expect(
      await failure(
        withTenant(test.app.db, a.creatorId, (tx) =>
          tx
            .update(s.conversations)
            .set({ state: 'sleeping' })
            .where(eq(s.conversations.id, a.conversationId)),
        ),
      ),
    ).toMatch(/conversations_state_check/);
  });

  it('refuses a price below zero on a message or a media send, and takes a free one', async () => {
    const message = (platformMessageId: string, priceMinor: number) =>
      withTenant(test.app.db, a.creatorId, (tx) =>
        tx.insert(s.messages).values({
          id: newId(MessageIdSchema),
          creatorId: a.creatorId,
          platformAccountId: a.accountId,
          conversationId: a.conversationId,
          platformMessageId,
          direction: 'outbound',
          author: 'human',
          priceMinor,
          currency: 'EUR',
          platformCreatedAt: at,
        }),
      );
    expect(await failure(message('msg-price-below-zero', -1))).toMatch(/messages_price_minor_check/);
    await message('msg-price-free', 0);
    expect(
      await failure(
        withTenant(test.app.db, a.creatorId, (tx) => tx.update(s.mediaSends).set({ priceMinor: -1500 })),
      ),
    ).toMatch(/media_sends_price_minor_check/);
  });

  it('migrating again changes nothing', async () => {
    await runMigrations(test.admin.db);
    const applied = await test.admin.db.execute(
      sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
    );
    expect(applied.rows[0]).toEqual({ n: SHIPPED_MIGRATIONS });
  });

  it('reports the migrations as up to date, and a missing one as pending', async () => {
    expect(await migrationStatus(test.admin.db)).toEqual({
      applied: SHIPPED_MIGRATIONS,
      expected: SHIPPED_MIGRATIONS,
      isUpToDate: true,
    });
    const rolledBack = new Error('rollback');
    await expect(
      test.admin.db.transaction(async (tx) => {
        await tx.execute(sql`delete from drizzle.__drizzle_migrations`);
        expect(await migrationStatus(tx)).toEqual({
          applied: 0,
          expected: SHIPPED_MIGRATIONS,
          isUpToDate: false,
        });
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
  it('reads one moment of the database in a snapshot read, and writes nothing there', async () => {
    const countFans = async (tx: Parameters<Parameters<typeof withTenant>[2]>[0]) => {
      const result = await tx.execute<{ n: number }>(sql`select count(*)::int as n from fans`);
      return result.rows[0]?.n;
    };
    const seen = await withTenant(
      test.app.db,
      a.creatorId,
      async (tx) => {
        const before = await countFans(tx);
        // Committed by someone else between the two reads: a snapshot does not see it.
        await test.admin.db.insert(s.fans).values({
          id: newId(FanIdSchema),
          creatorId: a.creatorId,
          platformAccountId: a.accountId,
          platformFanId: 'snapshot-fan',
          displayName: 'Fan',
        });
        return [before, await countFans(tx)];
      },
      SNAPSHOT_READ,
    );
    expect(seen[0]).toBe(seen[1]);
    expect(
      await failure(
        withTenant(
          test.app.db,
          a.creatorId,
          (tx) => tx.delete(s.fans).where(eq(s.fans.creatorId, a.creatorId)),
          SNAPSHOT_READ,
        ),
      ),
    ).toMatch(/read-only transaction/);
  });
});
