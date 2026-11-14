import {
  ConversationIdSchema,
  CreatorIdSchema,
  DraftIdSchema,
  FanIdSchema,
  MediaAssetIdSchema,
  MessageIdSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from '@impera/contracts';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  NotACreatorAccount,
  withAdmin,
  withCreatorAccount,
  withMember,
  withTenant,
  withTenantMember,
  type Database,
  type Transaction,
} from './client';
import * as s from './schema';
import { createTestDb, type TestDb } from './test/test-db';

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

interface Seeded {
  readonly creatorId: string;
  readonly accountId: string;
  readonly fanId: string;
  readonly conversationId: string;
  readonly mediaId: string;
}

/** A creator with a fan, a conversation, a message, a draft and what the agency alone reads; invented data only. */
async function seedCreator(admin: Database, label: string): Promise<Seeded> {
  const seeded = {
    creatorId: newId(CreatorIdSchema),
    accountId: newId(PlatformAccountIdSchema),
    fanId: newId(FanIdSchema),
    conversationId: newId(ConversationIdSchema),
    mediaId: newId(MediaAssetIdSchema),
  };
  const { creatorId, accountId, fanId, conversationId, mediaId } = seeded;
  const draftId = newId(DraftIdSchema);
  await withAdmin(admin, async (tx) => {
    await tx.insert(s.creators).values({
      id: creatorId,
      nameKey: creatorId,
      displayName: `Créatrice ${label}`,
      timezone: 'Europe/Paris',
    });
    await tx
      .insert(s.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: `h-${label}` });
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
      platformConversationId: 'c-1',
    });
    await tx
      .insert(s.drafts)
      .values({ id: draftId, creatorId, conversationId, idempotencyKey: `draft-${label}` });
    await tx.insert(s.messages).values({
      id: newId(MessageIdSchema),
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
  });
  return seeded;
}

async function count(tx: Transaction, table: string): Promise<number> {
  const result = await tx.execute(sql`select count(*)::int as n from ${sql.identifier(table)}`);
  const [row] = result.rows;
  return typeof row?.['n'] === 'number' ? row['n'] : -1;
}

/**
 * What a creator's account may do on each table that holds a creator's rows (Bilan's review of #460): every table with
 * `tenant_isolation` has a decision here, or a new table would open to her without anyone deciding it. `readsOnly`
 * carries the three `creator_no_*` policies, `closed` carries `creator_closed`, `hidden` carries `creator_no_select` (she
 * never reads it, a write of hers may add to it: CRM-04 lot d); an exception names its reason.
 */
const CREATOR_DECISIONS: Readonly<
  Record<string, 'readsOnly' | 'closed' | 'hidden' | { readonly exception: string }>
> = {
  conversations: 'readsOnly',
  messages: 'readsOnly',
  fans: 'readsOnly',
  fan_facts: 'readsOnly',
  fan_summaries: 'readsOnly',
  media_descriptions: 'readsOnly',
  media_assets: 'readsOnly',
  media_sends: 'readsOnly',
  media_platform_refs: 'readsOnly',
  platform_accounts: 'readsOnly',
  // The connector's own sends (P2-03): written by the agent's connector only.
  connector_sends: 'closed',
  drafts: 'closed',
  script_runs: 'closed',
  conversation_events: 'closed',
  llm_calls: 'closed',
  calibration_ratings: 'closed',
  blind_tests: 'closed',
  notifications: 'closed',
  kill_switches: 'closed',
  custom_alerts: 'closed',
  alert_seen: 'closed',
  system_alert_settings: 'closed',
  persona_versions: {
    exception:
      'elle écrit sa persona (Moi › Persona, ADR 0042 § 8) par la porte de l’agence : son enregistrement et son activation écrivent aussi le journal d’audit et les événements',
  },
  // She reads her sales through the view `creator_sales` (CRM-04 lot d): the register names who sold and the fan.
  platform_sales: 'closed',
  // `sale_detected` names who sold; an event her transaction publishes still goes in.
  domain_events: 'hidden',
  // The agency's training rows (ADR 0103): what the playground played, missed and marked in her name.
  playground_conversations: 'closed',
  playground_cases: 'closed',
  playground_case_runs: 'closed',
  desire_marks: 'closed',
};

/**
 * A creator's own account (CR-02, ADR 0042 § 2): `withCreatorAccount` is her one door, the base holds her to one
 * creator, and restrictive policies close to her what only the agency writes or reads. Invented data only (ADR 0010).
 */
describe('a creator’s own account (CR-02): one creator, her rows read-only, the agency’s rows closed', () => {
  let test: TestDb;
  let nora: Seeded;
  let ines: Seeded;
  const creatorUser = newId(UserIdSchema);
  const operator = newId(UserIdSchema);
  const chatter = newId(UserIdSchema);
  const kofi = newId(TeamMemberIdSchema);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    nora = await seedCreator(test.admin.db, 'Nora');
    ines = await seedCreator(test.admin.db, 'Ines');
    await withAdmin(test.admin.db, async (tx) => {
      await tx.insert(s.user).values([
        {
          id: creatorUser,
          name: 'Nora',
          email: 'nora@example.test',
          role: 'creator',
          creatorIds: [nora.creatorId],
        },
        {
          id: operator,
          name: 'Opé',
          email: 'ope@example.test',
          role: 'operator',
          creatorIds: [nora.creatorId],
        },
        { id: chatter, name: 'Kofi', email: 'kofi@example.test', role: 'operator', creatorIds: [] },
      ]);
      await tx.insert(s.teamMembers).values({
        id: kofi,
        userId: chatter,
        teamRole: 'chatter',
        firstName: 'Kofi',
        lastName: 'Inventé',
        displayName: 'Kofi',
        country: 'BJ',
        timeZone: 'Africa/Porto-Novo',
        joinedOn: '2026-09-01',
      });
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('holds a creator’s account to exactly one creator, in the base', async () => {
    const none = newId(UserIdSchema);
    const two = newId(UserIdSchema);
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx
            .insert(s.user)
            .values({ id: none, name: 'X', email: 'x@example.test', role: 'creator', creatorIds: [] }),
        ),
      ),
    ).toMatch(/user_creator_link_check/u);
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx.insert(s.user).values({
            id: two,
            name: 'Y',
            email: 'y@example.test',
            role: 'creator',
            creatorIds: [nora.creatorId, ines.creatorId],
          }),
        ),
      ),
    ).toMatch(/user_creator_link_check/u);
    expect(
      await failure(
        withAdmin(test.admin.db, (tx) =>
          tx.update(s.user).set({ creatorIds: [] }).where(eq(s.user.id, creatorUser)),
        ),
      ),
    ).toMatch(/user_creator_link_check/u);
  });

  it('opens only for a creator’s account, from the base, and sets her three settings', async () => {
    const settings = await withCreatorAccount(test.app.db, creatorUser, async (tx, creatorId) => {
      const result = await tx.execute(
        sql`select current_setting('app.user_id', true) as user_id, current_setting('app.account_role', true) as role,
                   current_setting('app.creator_id', true) as creator_id`,
      );
      return { creatorId, row: result.rows[0] };
    });
    expect(settings).toEqual({
      creatorId: nora.creatorId,
      row: { user_id: creatorUser, role: 'creator', creator_id: nora.creatorId },
    });
    for (const someone of [operator, chatter, newId(UserIdSchema)]) {
      await expect(
        withCreatorAccount(test.app.db, someone, () => Promise.resolve(null)),
      ).rejects.toBeInstanceOf(NotACreatorAccount);
    }
  });

  it('lets her read her fan, conversation and messages, never another creator’s', async () => {
    const seen = await withCreatorAccount(test.app.db, creatorUser, async (tx) => ({
      fans: await tx.select({ creatorId: s.fans.creatorId }).from(s.fans),
      conversations: await tx.select({ creatorId: s.conversations.creatorId }).from(s.conversations),
      messages: await tx.select({ text: s.messages.text, creatorId: s.messages.creatorId }).from(s.messages),
      media: await tx.select({ creatorId: s.mediaDescriptions.creatorId }).from(s.mediaDescriptions),
    }));
    expect(seen).toEqual({
      fans: [{ creatorId: nora.creatorId }],
      conversations: [{ creatorId: nora.creatorId }],
      messages: [{ text: 'Salut', creatorId: nora.creatorId }],
      media: [{ creatorId: nora.creatorId }],
    });
  });

  it('closes to her the drafts, the guard traces, the model calls, the calibration and the event log', async () => {
    const closed = ['drafts', 'llm_calls', 'calibration_ratings', 'conversation_events'];
    const asCreator = await withCreatorAccount(test.app.db, creatorUser, async (tx) =>
      Promise.all(closed.map((table) => count(tx, table))),
    );
    expect(asCreator).toEqual([0, 0, 0, 0]);
    // The agency still reads them in her creator: the restrictive policy keys on the account, not the tenant.
    const asAgency = await withTenant(test.app.db, nora.creatorId, (tx) =>
      Promise.all(closed.map((table) => count(tx, table))),
    );
    expect(asAgency).toEqual([1, 1, 1, 1]);
  });

  it('refuses her every write on conversations, messages, fans and media descriptions', async () => {
    const insertions: readonly [string, (tx: Transaction) => Promise<unknown>][] = [
      [
        'fans',
        (tx) =>
          tx.insert(s.fans).values({
            id: newId(FanIdSchema),
            creatorId: nora.creatorId,
            platformAccountId: nora.accountId,
            platformFanId: 'fan-2',
            displayName: 'Autre',
          }),
      ],
      [
        'conversations',
        (tx) =>
          tx.insert(s.conversations).values({
            id: newId(ConversationIdSchema),
            creatorId: nora.creatorId,
            platformAccountId: nora.accountId,
            fanId: nora.fanId,
            platformConversationId: 'c-2',
          }),
      ],
      [
        'messages',
        (tx) =>
          tx.insert(s.messages).values({
            id: newId(MessageIdSchema),
            creatorId: nora.creatorId,
            platformAccountId: nora.accountId,
            conversationId: nora.conversationId,
            platformMessageId: 'msg-2',
            direction: 'outbound',
            author: 'human',
            text: 'Coucou',
            platformCreatedAt: at,
          }),
      ],
      [
        'media_descriptions',
        (tx) =>
          tx.insert(s.mediaDescriptions).values({
            id: newId(MessageIdSchema),
            creatorId: nora.creatorId,
            mediaAssetId: nora.mediaId,
            vocabularyVersion: '1',
            content: {},
            model: 'm',
            promptHash: 'p',
          }),
      ],
    ];
    for (const [table, insert] of insertions) {
      expect(await failure(withCreatorAccount(test.app.db, creatorUser, insert)), table).toMatch(
        /row-level security/u,
      );
    }
    // An update or a delete finds no row to touch: the restrictive policy hides them from both.
    const touched = await withCreatorAccount(test.app.db, creatorUser, async (tx) => ({
      fans: (await tx.update(s.fans).set({ displayName: 'Changé' }).returning({ id: s.fans.id })).length,
      conversations: (
        await tx
          .update(s.conversations)
          .set({ platformConversationId: 'x' })
          .returning({ id: s.conversations.id })
      ).length,
      messages: (await tx.update(s.messages).set({ text: 'Changé' }).returning({ id: s.messages.id })).length,
      media: (await tx.delete(s.mediaDescriptions).returning({ id: s.mediaDescriptions.id })).length,
      deletedMessages: (await tx.delete(s.messages).returning({ id: s.messages.id })).length,
    }));
    expect(touched).toEqual({ fans: 0, conversations: 0, messages: 0, media: 0, deletedMessages: 0 });
    // The agency still writes them.
    const agency = await withTenant(test.app.db, nora.creatorId, async (tx) =>
      tx.update(s.fans).set({ displayName: 'Fan test' }).returning({ id: s.fans.id }),
    );
    expect(agency).toHaveLength(1);
  });

  it('shows her no line of the team', async () => {
    const rows = await withCreatorAccount(test.app.db, creatorUser, (tx) => count(tx, 'team_members'));
    expect(rows).toBe(0);
  });

  it('keeps a creator a creator when she comes through withMember or withTenantMember by mistake', async () => {
    const role = (tx: Transaction) =>
      tx
        .execute(sql`select current_setting('app.account_role', true) as role`)
        .then((r) => r.rows[0]?.['role']);
    expect(await withMember(test.app.db, creatorUser, role)).toBe('creator');
    expect(await withMember(test.app.db, chatter, role)).toBe('operator');
    const closed = await withTenantMember(test.app.db, nora.creatorId, creatorUser, (tx) =>
      count(tx, 'drafts'),
    );
    expect(closed).toBe(0);
    const writes = await failure(
      withTenantMember(test.app.db, nora.creatorId, creatorUser, (tx) =>
        tx.insert(s.fans).values({
          id: newId(FanIdSchema),
          creatorId: nora.creatorId,
          platformAccountId: nora.accountId,
          platformFanId: 'fan-3',
          displayName: 'Autre',
        }),
      ),
    );
    expect(writes).toMatch(/row-level security/u);
  });

  it('has a decision for her on every table with tenant_isolation, and the policies that carry it', async () => {
    const result = await test.admin.db.execute(
      sql`select tablename, policyname from pg_policies where schemaname = 'public' order by tablename, policyname`,
    );
    const policies = new Map<string, string[]>();
    for (const row of result.rows) {
      const table = String(row['tablename']);
      policies.set(table, [...(policies.get(table) ?? []), String(row['policyname'])]);
    }
    const tenantTables = [...policies]
      .filter(([, names]) => names.includes('tenant_isolation'))
      .map(([t]) => t);
    expect(tenantTables.filter((table) => !(table in CREATOR_DECISIONS))).toEqual([]);
    expect(Object.keys(CREATOR_DECISIONS).filter((table) => !tenantTables.includes(table))).toEqual([]);
    for (const table of tenantTables) {
      const decision = CREATOR_DECISIONS[table];
      const own = (policies.get(table) ?? []).filter((name) => name.startsWith('creator_'));
      if (decision === 'readsOnly')
        expect(own, table).toEqual(['creator_no_delete', 'creator_no_insert', 'creator_no_update']);
      else if (decision === 'closed') expect(own, table).toEqual(['creator_closed']);
      else if (decision === 'hidden') expect(own, table).toEqual(['creator_no_select']);
      else expect(decision?.exception, table).toMatch(/\S/u);
    }
  });

  it('shows her who is on shift on her accounts, by display name and range only, and nobody else', async () => {
    const startsAt = new Date('2026-10-17T12:00:00Z');
    const endsAt = new Date('2026-10-17T18:00:00Z');
    await withAdmin(test.admin.db, async (tx) => {
      // The same member, later the same day, on another creator.
      const later = 7 * 3_600_000;
      for (const [creator, shift] of [
        [nora, 0],
        [ines, later],
      ] as const) {
        await tx.insert(s.shifts).values({
          id: newId(ShiftIdSchema),
          creatorId: creator.creatorId,
          platformAccountId: creator.accountId,
          memberId: kofi,
          startsAt: new Date(startsAt.getTime() + shift),
          endsAt: new Date(endsAt.getTime() + shift),
          createdBy: operator,
          updatedBy: operator,
        });
      }
    });
    const seen = await withCreatorAccount(test.app.db, creatorUser, (tx) =>
      tx.select().from(s.creatorOnDuty),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      creatorId: nora.creatorId,
      platformAccountId: nora.accountId,
      displayName: 'Kofi',
      startsAt,
      endsAt,
    });
    expect(Object.keys(seen[0] ?? {}).sort()).toEqual(
      ['creatorId', 'displayName', 'endsAt', 'platformAccountId', 'shiftId', 'startsAt'].sort(),
    );
    // The agency and the jobs read the planning by its own routes: the view is empty for them.
    expect(await withTenant(test.app.db, nora.creatorId, (tx) => count(tx, 'creator_on_duty'))).toBe(0);
    expect(await withMember(test.app.db, operator, (tx) => count(tx, 'creator_on_duty'))).toBe(0);
    // Nothing writes through it.
    const write = await failure(
      withCreatorAccount(test.app.db, creatorUser, (tx) => tx.execute(sql`delete from creator_on_duty`)),
    );
    expect(write).toMatch(/permission denied|cannot delete/u);
  });
});
