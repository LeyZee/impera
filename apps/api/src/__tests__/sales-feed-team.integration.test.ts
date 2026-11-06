import {
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  TeamImportCountsSchema,
  TeamImportLinksResultSchema,
  TeamImportOverviewSchema,
  TeamMemberIdSchema,
  type TeamImportOverview,
  type TeamMemberId,
} from '@impera/contracts';
import { and, eq, schema, withMember } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { revealSalesFeed, type SalesFeedFetch } from '../modules/connectors';
import { buildServer, type Server } from '../server';

import { createFakeCrm, FAKE_CRM_BASE_URL, FAKE_CRM_KEY, type FakeCrm } from './fake-reveal/crm';
import { testConfig } from './support/config';
import { LogSink } from './support/log-sink';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

// Invented people and accounts (ADR 0010).
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const MANAGER = { email: 'max@recette.test', name: 'Max', password: 'staple battery horse' };
const CHATTER = { email: 'zoe@recette.test', name: 'Zoé', password: 'battery staple horse' };

interface WireChatter {
  chatterId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  role: string | null;
  isBot: boolean;
  isExternal: boolean;
  removedAt: string | null;
  modelIds: string[];
}

const account = (chatterId: string, patch: Partial<WireChatter> = {}): WireChatter => ({
  chatterId,
  firstName: 'Prénom',
  lastName: 'Inventé',
  email: null,
  role: 'chatter',
  isBot: false,
  isExternal: false,
  removedAt: null,
  modelIds: [],
  ...patch,
});

/** The team listed by the platform: each case of ADR 0076 § 1, § 2. */
const TEAM: readonly WireChatter[] = [
  account('chatter_lea', {
    firstName: 'Autre',
    lastName: 'Nom',
    email: 'LEA@recette.test',
    modelIds: ['model_test_01'],
  }),
  account('chatter_max', { firstName: 'Max', lastName: 'Test', email: 'max@recette.test', role: 'manager' }),
  account('chatter_key', { firstName: 'Clé', lastName: 'API', isBot: true }),
  account('chatter_presta', { firstName: 'Presta', lastName: 'Externe', isExternal: true }),
  account('chatter_new', { firstName: 'Nouveau', lastName: 'Venu', email: 'nouveau@recette.test' }),
  account('chatter_bot', { firstName: 'bot', lastName: '' }),
  // Reveal sends no role for some accounts.
  account('chatter_norole', { firstName: 'Sans', lastName: 'Rôle', role: null }),
];

/** The ADR 0076 review of the platform's team, through the real app, FakeReveal's list replaced by the test's. */
describe('team imported from the platform after review (ADR 0076)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let crm: FakeCrm;
  let owner: string;
  let manager: string;
  let chatter: string;
  let managerUser: string;
  let lea: TeamMemberId;
  let max: TeamMemberId;
  let listed: WireChatter[] = [...TEAM];
  let listFails = false;
  let listReads = 0;

  /** FakeReveal, but `/v1/chatters` answers the list the test sets, or fails when it says so. */
  const fetchWith: SalesFeedFetch = async (url, init) => {
    if (new URL(url).pathname === '/v1/chatters') {
      listReads += 1;
      if (listFails) {
        return { status: 503, headers: { get: () => 'text/plain' }, text: () => Promise.resolve('down') };
      }
      const body = JSON.stringify({ data: listed });
      return { status: 200, headers: { get: () => 'application/json' }, text: () => Promise.resolve(body) };
    }
    return crm.fetch(url, init);
  };

  async function api(method: 'GET' | 'PUT' | 'POST', url: string, cookie: string, payload?: object) {
    return server.inject({
      method,
      url: `/v1/settings/sales-feeds/reveal${url}`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  const overviewAs = async (cookie: string): Promise<TeamImportOverview> => {
    const response = await api('GET', '/team', cookie);
    expect(response.statusCode, response.body).toBe(200);
    return TeamImportOverviewSchema.parse(response.json());
  };
  const rowOf = (overview: TeamImportOverview, id: string) =>
    overview.rows.find((row) => row.chatter.platformChatterId === id);

  async function member(
    userId: string,
    teamRole: 'manager' | 'chatter',
    first: string,
  ): Promise<TeamMemberId> {
    const id = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id,
      userId,
      teamRole,
      firstName: first,
      lastName: 'Test',
      displayName: first,
      country: 'MG',
      timeZone: 'Indian/Antananarivo',
      joinedOn: '2026-10-01',
    });
    return id;
  }

  async function operator(person: { email: string; name: string; password: string }): Promise<string> {
    const { userId } = await createOwner(app.auth, app.db.db, person);
    await test.admin.db.update(schema.user).set({ role: 'operator' }).where(eq(schema.user.id, userId));
    return userId;
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    crm = createFakeCrm();
    const config = testConfig({
      DATABASE_URL: test.appUrl,
      DATABASE_ADMIN_URL: test.adminUrl,
      CREDENTIALS_ENCRYPTION_KEYS: `v1:${Buffer.alloc(32, 7).toString('base64')}`,
    });
    const logger = createLogger(config, new LogSink());
    app = await createApp(config, logger, {
      salesFeeds: { reveal: revealSalesFeed(fetchWith, FAKE_CRM_BASE_URL) },
    });
    server = await buildServer({ config, logger, routes: app.routes, readiness: app.readiness });
    await createOwner(app.auth, app.db.db, OWNER);
    managerUser = await operator(MANAGER);
    const chatterUser = await operator(CHATTER);
    max = await member(managerUser, 'manager', 'Max');
    await member(chatterUser, 'chatter', 'Zoé');
    const leaUser = 'user_test_lea';
    await test.admin.db
      .insert(schema.user)
      .values({ id: leaUser, name: 'Léa', email: 'lea@recette.test', role: 'operator' });
    lea = await member(leaUser, 'chatter', 'Léa');
    const creator = newId(CreatorIdSchema);
    await test.admin.db.insert(schema.creators).values({
      id: creator,
      nameKey: 'creatrice_test',
      displayName: 'Créatrice Test',
      timezone: 'Europe/Paris',
    });
    await test.admin.db.insert(schema.platformAccounts).values({
      id: newId(PlatformAccountIdSchema),
      creatorId: creator,
      platform: 'reveal',
      handle: 'creatrice_test',
    });
    owner = await signIn(server, OWNER.email, OWNER.password);
    manager = await signIn(server, MANAGER.email, MANAGER.password);
    chatter = await signIn(server, CHATTER.email, CHATTER.password);
    const connected = await api('PUT', '/key', owner, { key: FAKE_CRM_KEY });
    expect(connected.statusCode, connected.body).toBe(200);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await crm.app.close();
    await test.close();
  });

  it('proposes an action per account, never links on its own, and is closed to a chatter', async () => {
    expect((await api('GET', '/team', chatter)).statusCode).toBe(403);
    expect((await api('GET', '/team/counts', chatter)).statusCode).toBe(403);
    const overview = await overviewAs(owner);
    expect(rowOf(overview, 'chatter_lea')).toMatchObject({
      link: null,
      suggestion: { kind: 'member', memberId: lea, match: 'email' },
      preselected: true,
      models: [
        { platformModelId: 'model_test_01', handle: 'creatrice_test', creatorDisplayName: 'Créatrice Test' },
      ],
    });
    expect(rowOf(overview, 'chatter_key')).toMatchObject({ suggestion: { kind: 'none' }, preselected: true });
    expect(rowOf(overview, 'chatter_presta')?.suggestion).toEqual({ kind: 'none' });
    expect(rowOf(overview, 'chatter_new')).toMatchObject({
      suggestion: { kind: 'invite' },
      preselected: false,
    });
    expect(rowOf(overview, 'chatter_bot')).toMatchObject({
      suggestion: { kind: 'agent', match: 'name' },
      preselected: false,
    });
    // Every account but the API key's bot is new.
    expect(overview.newCount).toBe(6);
    expect(rowOf(overview, 'chatter_norole')?.chatter.role).toBe('');
    expect(await test.admin.db.select().from(schema.salesFeedChatters)).toEqual([]);
    const counts = TeamImportCountsSchema.parse((await api('GET', '/team/counts', manager)).json());
    expect(counts).toEqual({ newCount: 6, removalCount: 0, abnormalRead: false });
  });

  it('lets a manager confirm the batch, never on his own record nor a provider to a member', async () => {
    const response = await api('POST', '/team/links', manager, {
      items: [
        { platformChatterId: 'chatter_lea', link: { kind: 'member', memberId: lea } },
        { platformChatterId: 'chatter_max', link: { kind: 'member', memberId: max } },
        { platformChatterId: 'chatter_presta', link: { kind: 'member', memberId: lea } },
        { platformChatterId: 'chatter_key', link: { kind: 'none' } },
        { platformChatterId: 'chatter_gone', link: { kind: 'agent' } },
      ],
    });
    expect(response.statusCode, response.body).toBe(200);
    const result = TeamImportLinksResultSchema.parse(response.json());
    expect(result.results.map((row) => (row.ok ? 'ok' : row.error.kind))).toEqual([
      'ok',
      'own_link',
      'external_owner_only',
      'ok',
      'not_listed',
    ]);
    expect(rowOf(result.overview, 'chatter_lea')?.link).toEqual({
      kind: 'member',
      memberId: lea,
      memberDisplayName: 'Léa',
    });
    expect(rowOf(result.overview, 'chatter_key')?.link).toEqual({ kind: 'none' });

    // The owner links the manager's own account; the manager then sees his row without any action.
    const own = await api('POST', '/team/links', owner, {
      items: [{ platformChatterId: 'chatter_max', link: { kind: 'member', memberId: max } }],
    });
    expect(TeamImportLinksResultSchema.parse(own.json()).results[0]?.ok).toBe(true);
    expect(rowOf(await overviewAs(manager), 'chatter_max')?.actions).toEqual([]);
    const away = await api('POST', '/team/links', manager, {
      items: [{ platformChatterId: 'chatter_max', link: { kind: 'none' } }],
    });
    expect(TeamImportLinksResultSchema.parse(away.json()).results[0]).toMatchObject({
      ok: false,
      error: { kind: 'own_link' },
    });
  });

  it('holds the guard against himself in the base, whatever the route (migration 0132)', async () => {
    const key = and(
      eq(schema.salesFeedChatters.platform, 'reveal'),
      eq(schema.salesFeedChatters.platformChatterId, 'chatter_max'),
    );
    // His own link is out of his reach: no row to delete or move.
    const deleted = await withMember(app.db.db, managerUser, (tx) =>
      tx.delete(schema.salesFeedChatters).where(key).returning(),
    );
    expect(deleted).toEqual([]);
    const moved = await withMember(app.db.db, managerUser, (tx) =>
      tx.update(schema.salesFeedChatters).set({ kind: 'agent', memberId: null }).where(key).returning(),
    );
    expect(moved).toEqual([]);
    // And never a new link to himself.
    await expect(
      withMember(app.db.db, managerUser, (tx) =>
        tx.insert(schema.salesFeedChatters).values({
          platform: 'reveal',
          platformChatterId: 'chatter_new',
          kind: 'member',
          memberId: max,
        }),
      ),
    ).rejects.toThrow();
    const [still] = await test.admin.db.select().from(schema.salesFeedChatters).where(key);
    expect(still).toMatchObject({ kind: 'member', memberId: max });
  });

  it('sets an account aside and takes it back; a linked one is changed, not set aside', async () => {
    const aside = await api('PUT', '/team/chatter_new/dismissal', manager, { dismissed: true });
    expect(aside.statusCode, aside.body).toBe(200);
    const after = TeamImportOverviewSchema.parse(aside.json());
    expect(rowOf(after, 'chatter_new')).toMatchObject({ suggestion: null });
    expect(rowOf(after, 'chatter_new')?.dismissedAt).not.toBeNull();
    const back = TeamImportOverviewSchema.parse(
      (await api('PUT', '/team/chatter_new/dismissal', owner, { dismissed: false })).json(),
    );
    expect(rowOf(back, 'chatter_new')).toMatchObject({ dismissedAt: null, suggestion: { kind: 'invite' } });
    const linked = await api('PUT', '/team/chatter_lea/dismissal', owner, { dismissed: true });
    expect(linked.statusCode).toBe(409);
  });

  it('refuses a chatter before any reading of the platform, and an account no key links', async () => {
    const before = listReads;
    const batch = await api('POST', '/team/links', chatter, {
      items: [{ platformChatterId: 'chatter_new', link: { kind: 'none' } }],
    });
    expect(batch.statusCode).toBe(403);
    expect((await api('PUT', '/team/chatter_new/dismissal', chatter, { dismissed: true })).statusCode).toBe(
      403,
    );
    expect(listReads).toBe(before);

    const refused = await api('POST', '/team/links', owner, {
      items: [
        { platformChatterId: 'chatter_presta', link: { kind: 'agent' } },
        { platformChatterId: 'chatter_new', link: { kind: 'member', memberId: newId(TeamMemberIdSchema) } },
      ],
    });
    expect(refused.statusCode, refused.body).toBe(200);
    expect(
      TeamImportLinksResultSchema.parse(refused.json()).results.map((row) =>
        row.ok ? 'ok' : row.error.kind,
      ),
    ).toEqual(['external_no_agent', 'member_unknown']);
    const [presta] = await test.admin.db
      .select()
      .from(schema.salesFeedChatters)
      .where(eq(schema.salesFeedChatters.platformChatterId, 'chatter_presta'));
    expect(presta).toBeUndefined();
  });

  it('confirms nothing while the platform does not answer its list', async () => {
    listFails = true;
    try {
      const response = await api('POST', '/team/links', owner, {
        items: [{ platformChatterId: 'chatter_new', link: { kind: 'none' } }],
      });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({ error: { code: 'sales_feed_list_unavailable' } });
    } finally {
      listFails = false;
    }
    const [none] = await test.admin.db
      .select()
      .from(schema.salesFeedChatters)
      .where(eq(schema.salesFeedChatters.platformChatterId, 'chatter_new'));
    expect(none).toBeUndefined();
  });

  it('makes a removal an alert as long as it lasts, and never believes an empty list', async () => {
    const counts = async () => TeamImportCountsSchema.parse((await api('GET', '/team/counts', owner)).json());
    listed = TEAM.map((one) =>
      one.chatterId === 'chatter_lea' ? { ...one, removedAt: '2026-11-05T10:00:00.000Z' } : one,
    );
    const removed = await overviewAs(owner);
    expect(rowOf(removed, 'chatter_lea')?.removal).toEqual({
      memberId: lea,
      removedAt: '2026-11-05T10:00:00.000Z',
      absent: false,
    });
    expect((await counts()).removalCount).toBe(1);
    // `team` reads the same warning for the member's page, the manager too.
    expect(await app.modules.connectors.teamRemovals(managerUser)).toEqual([
      {
        platform: 'reveal',
        platformChatterId: 'chatter_lea',
        memberId: lea,
        removedAt: '2026-11-05T10:00:00.000Z',
        absent: false,
      },
    ]);

    // Gone from the list after a believed reading: still one alert, its link kept.
    listed = TEAM.filter((one) => one.chatterId !== 'chatter_lea');
    const gone = await overviewAs(owner);
    expect(rowOf(gone, 'chatter_lea')).toMatchObject({ link: { kind: 'member', memberId: lea } });
    expect(rowOf(gone, 'chatter_lea')?.removal).toMatchObject({ memberId: lea, absent: true });
    expect(await counts()).toMatchObject({ removalCount: 1, abnormalRead: false });

    // An empty list is one « lecture anormale », nothing more.
    listed = [];
    await overviewAs(owner);
    expect(await counts()).toMatchObject({ removalCount: 1, abnormalRead: true });

    // Back on the platform: the alert closes.
    listed = [...TEAM];
    const returned = await overviewAs(owner);
    expect(rowOf(returned, 'chatter_lea')?.removal).toBeNull();
    expect(await counts()).toMatchObject({ removalCount: 0, abnormalRead: false });
    expect(await app.modules.connectors.teamRemovals(managerUser)).toEqual([]);
  });

  it('does not believe an empty first reading when accounts are already linked', async () => {
    await test.admin.db.delete(schema.salesFeedTeamReadings);
    listed = [];
    try {
      await overviewAs(owner);
      expect(TeamImportCountsSchema.parse((await api('GET', '/team/counts', owner)).json())).toMatchObject({
        removalCount: 0,
        abnormalRead: true,
      });
    } finally {
      listed = [...TEAM];
    }
  });
});
