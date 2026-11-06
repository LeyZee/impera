import {
  ConversationDetailSchema,
  ConversationSummarySchema,
  CreatorIdSchema,
  EventIdSchema,
  MeSchema,
  MyShiftsSchema,
  newId,
  pageOf,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  TodosAcrossCreatorsSchema,
  type ConversationId,
  type CreatorId,
} from '@impera/contracts';
import { and, createDbClient, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { createShiftAccessReader } from '../modules/scheduling';
import { buildServer, type Server } from '../server';

import { fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const NO_LOG = { info: () => undefined, warn: () => undefined };
const PASSWORD = 'correct horse battery';
const MINUTE = 60_000;

interface Member {
  readonly userId: string;
  readonly memberId: string;
  readonly cookie: string;
}

/**
 * A chatter's access bounded to his shift (ADR 0025, EQ-13, reco 7 of the recette du 05/11): in his window he treats
 * every conversation of the creator he is on; outside it, only what he holds. The planning keeps its past (a shift is
 * never deleted, an ended one never changes), so each case has its own chatter. Invented data only (ADR 0010).
 */
describe('access of a chatter during his shift (EQ-13)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let ownerCookie: string;
  let members = 0;
  /** How far the access window's clock runs ahead of the system's, in minutes; 0 but in the test that moves it. */
  let ahead = 0;
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const ines = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const conversations = new Map<string, ConversationId>();
  let inesConversation: ConversationId;

  function call(method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: object) {
    return server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });
  }

  const conversation = (name: string): ConversationId => {
    const id = conversations.get(name);
    if (id === undefined) throw new Error(`no conversation ${name}`);
    return id;
  };

  async function seed(creator: typeof nora, name: string): Promise<ConversationId> {
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId: creator.creatorId,
      platformAccountId: creator.accountId,
      platformConversationId: `c-${name}`,
      platformFanId: `f-${name}`,
      fanDisplayName: name,
      message: {
        ref: { platform: 'reveal', id: `m-${name}` },
        conversationRef: { platform: 'reveal', id: `c-${name}` },
        direction: 'inbound',
        text: `Salut, c'est ${name}`,
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'seed',
    });
    await app.modules.conversations.jobs.respond(
      { creatorId: creator.creatorId, conversationId, correlationId: 'seed' },
      NO_LOG,
    );
    return conversationId;
  }

  /** A member of the team on Nora, signed in: a chatter (scope `self`) unless said otherwise. */
  async function member(teamRole: 'chatter' | 'manager' = 'chatter'): Promise<Member> {
    members += 1;
    const email = `${teamRole}-${String(members)}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: teamRole, password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [nora.creatorId] })
      .where(eq(schema.user.id, userId));
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole,
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `${teamRole} ${String(members)}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    return { userId, memberId, cookie: await signIn(server, email, PASSWORD) };
  }

  /**
   * One shift of the member, in minutes from now (whole minutes, as the planning writes them), each on an account of
   * its own: an account takes three shifts at once at most (ADR 0049), and the window opens the creator, whatever
   * her account.
   */
  async function shift(
    who: Member,
    from: number,
    to: number,
    options: { creator?: typeof nora; cancelled?: boolean; stopped?: boolean } = {},
  ): Promise<void> {
    const creator = options.creator ?? nora;
    const accountId = newId(PlatformAccountIdSchema);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: accountId,
      creatorId: creator.creatorId,
      platform: 'reveal',
      handle: `shift-${accountId}`,
    });
    const base = Math.floor(Date.now() / MINUTE) * MINUTE;
    const endsAt = new Date(base + to * MINUTE);
    await test.admin.db.insert(schema.shifts).values({
      id: newId(ShiftIdSchema),
      creatorId: creator.creatorId,
      platformAccountId: accountId,
      memberId: who.memberId,
      startsAt: new Date(base + from * MINUTE),
      endsAt,
      cancelledAt: options.cancelled === true ? new Date() : null,
      stoppedAt: options.stopped === true ? endsAt : null,
      createdBy: ownerId,
      updatedBy: ownerId,
    });
  }

  /** A chatter whose only shift is this one. */
  async function chatterWith(
    from: number,
    to: number,
    options?: Parameters<typeof shift>[3],
  ): Promise<Member> {
    const who = await member();
    await shift(who, from, to, options);
    return who;
  }

  const me = async (who: Member) => MeSchema.parse((await call('GET', '/v1/me', who.cookie)).json());

  const list = async (cookie: string, creatorId: CreatorId = nora.creatorId) => {
    const response = await call('GET', `/v1/conversations?creatorId=${creatorId}`, cookie);
    if (response.statusCode !== 200) return response.statusCode;
    return pageOf(ConversationSummarySchema).parse(response.json()).items;
  };

  const listed = async (cookie: string) => {
    const items = await list(cookie);
    if (typeof items === 'number') throw new Error(`the list answered ${String(items)}`);
    return items;
  };

  const read = (id: ConversationId, cookie: string, creatorId: CreatorId = nora.creatorId) =>
    call('GET', `/v1/conversations/${id}?creatorId=${creatorId}`, cookie);

  const act = (id: ConversationId, action: 'takeover' | 'release', cookie: string) =>
    call('POST', `/v1/conversations/${id}/${action}?creatorId=${nora.creatorId}`, cookie, {});

  const todos = async (cookie: string) =>
    TodosAcrossCreatorsSchema.parse((await call('GET', '/v1/dashboard/todos', cookie)).json()).items;

  const openings = (who: Member, id: ConversationId) =>
    test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.userId, who.userId),
          eq(schema.auditLog.action, 'conversation.open'),
          eq(schema.auditLog.entityId, id),
        ),
      );

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
    app = await createApp(config, createLogger(config), {
      composer: fixedComposer,
      accessClock: () => new Date(Date.now() + ahead * MINUTE),
    });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    for (const [creator, label] of [
      [nora, 'nora'],
      [ines, 'ines'],
    ] as const) {
      await test.admin.db.insert(schema.creators).values({
        id: creator.creatorId,
        nameKey: creator.creatorId,
        displayName: label,
        timezone: 'Europe/Paris',
      });
      await activateDemoPersona(app, creator.creatorId);
      await test.admin.db.insert(schema.platformAccounts).values({
        id: creator.accountId,
        creatorId: creator.creatorId,
        platform: 'reveal',
        handle: `${label}-reveal`,
      });
    }
    for (const name of ['Julien', 'Marc', 'Paul']) conversations.set(name, await seed(nora, name));
    inesConversation = await seed(ines, 'Hugo');

    const owner = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, owner));
    ownerCookie = await signIn(server, owner.email, owner.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('opens his creator from the margin before his shift to the margin after it, never in his own list', async () => {
    expect((await me(await member())).shiftCreatorIds).toEqual([]);

    const onShift = await chatterWith(-60, 60);
    // Never in his own list: the whole creator (her mode, her Dashboard) stays the owner's and the managers'.
    expect(await me(onShift)).toMatchObject({
      creatorIds: [],
      routedCreatorIds: [nora.creatorId],
      shiftCreatorIds: [nora.creatorId],
      teamScope: 'self',
    });

    // The default margin, 15 minutes, on each side.
    const cases: [from: number, to: number, open: boolean][] = [
      [10, 120, true],
      [20, 120, false],
      [-120, -10, true],
      [-120, -20, false],
    ];
    for (const [from, to, open] of cases) {
      const who = await chatterWith(from, to);
      expect((await me(who)).shiftCreatorIds, `${String(from)} → ${String(to)}`).toEqual(
        open ? [nora.creatorId] : [],
      );
    }
  });

  it('keeps no end margin after a shift stopped under way, and none for a cancelled one', async () => {
    expect((await me(await chatterWith(-120, -5, { stopped: true }))).shiftCreatorIds).toEqual([]);
    expect((await me(await chatterWith(-60, 60, { cancelled: true }))).shiftCreatorIds).toEqual([]);
  });

  it('opens nothing for a shift planned on a creator outside his list (reco 8)', async () => {
    const who = await chatterWith(-60, 60, { creator: ines });
    expect((await me(who)).shiftCreatorIds).toEqual([]);
    expect(await list(who.cookie, ines.creatorId)).toBe(403);
    expect((await read(inesConversation, who.cookie, ines.creatorId)).statusCode).toBe(403);
  });

  it('reads the margin the owner set, at each request', async () => {
    const who = await chatterWith(10, 120);
    expect((await me(who)).shiftCreatorIds).toEqual([nora.creatorId]);
    await test.admin.db.insert(schema.schedulingSettings).values({
      id: 1,
      timeZone: 'Europe/Paris',
      slotStartMinute: 0,
      slotLengthMinutes: 60,
      accessMarginMinutes: 0,
      updatedBy: ownerId,
    });
    try {
      expect((await me(who)).shiftCreatorIds).toEqual([]);
    } finally {
      await test.admin.db.delete(schema.schedulingSettings);
    }
  });

  it('reads his shift on the injected clock, the margins included', async () => {
    const who = await chatterWith(180, 300);
    expect((await me(who)).shiftCreatorIds).toEqual([]);
    try {
      for (const [minutes, open] of [
        [160, false],
        [170, true],
        [240, true],
        [310, true],
        [320, false],
      ] as const) {
        ahead = minutes;
        expect((await me(who)).shiftCreatorIds, `${String(minutes)} minutes ahead`).toEqual(
          open ? [nora.creatorId] : [],
        );
      }
      ahead = 240;
      expect(await listed(who.cookie)).toHaveLength(3);
    } finally {
      ahead = 0;
    }
  });

  it('closes his window when it cannot be read, never answering an error', async () => {
    const unreachable = createDbClient('postgres://nobody:nothing@127.0.0.1:1/none', {
      connectionTimeoutMillis: 2_000,
    });
    const warnings: string[] = [];
    try {
      const read = createShiftAccessReader(unreachable.db, {
        logger: { warn: (_object, message) => warnings.push(message) },
      });
      expect(await read((await member()).userId, [nora.creatorId])).toEqual([]);
      expect(warnings).toEqual(['shift access window unreadable: closed']);
    } finally {
      await unreachable.close();
    }
  });

  it('gives a member away from the team no window, and never bounds an active manager', async () => {
    const who = await chatterWith(-60, 60);
    await test.admin.db
      .update(schema.teamMembers)
      .set({ status: 'suspended' })
      .where(eq(schema.teamMembers.id, who.memberId));
    expect((await me(who)).shiftCreatorIds).toEqual([]);
    expect(await list(who.cookie)).toBe(403);
    expect((await read(conversation('Julien'), who.cookie)).statusCode).toBe(403);

    const manager = await member('manager');
    expect(await me(manager)).toMatchObject({ creatorIds: [nora.creatorId], shiftCreatorIds: [] });
    expect(await listed(manager.cookie)).toHaveLength(3);
    // « Mes shifts » is his own, read as him: never the shift of a chatter on now, which he plans and reads on Nora.
    const mine = async (cookie: string) =>
      MyShiftsSchema.parse((await call('GET', '/v1/scheduling/my-shifts', cookie)).json());
    expect((await mine(manager.cookie)).current).toBeNull();
    await shift(manager, -30, 30);
    expect((await mine(manager.cookie)).current).toMatchObject({
      memberId: manager.memberId,
      creatorId: nora.creatorId,
    });
    const chatter = await chatterWith(-45, 45);
    expect((await mine(chatter.cookie)).current).toMatchObject({ memberId: chatter.memberId });
  });

  it('lets him treat every conversation of his creator in his shift, never her mode nor her Dashboard', async () => {
    const who = await chatterWith(-60, 60);
    const items = await listed(who.cookie);
    expect(items.map((item) => item.fanDisplayName).sort()).toEqual(['Julien', 'Marc', 'Paul']);
    expect(items.map((item) => item.heldBy)).toEqual([null, null, null]);

    const julien = conversation('Julien');
    for (const path of ['', '/messages', '/events', '/desire']) {
      const url = `/v1/conversations/${julien}${path}?creatorId=${nora.creatorId}`;
      expect((await call('GET', url, who.cookie)).statusCode, path).toBe(200);
    }
    // He decides the agent's draft.
    const detail = ConversationDetailSchema.parse((await read(julien, who.cookie)).json());
    const draft = detail.openDrafts.find((open) => open.status === 'pending');
    if (draft === undefined) throw new Error('Julien waits for a draft');
    const approved = await call(
      'POST',
      `/v1/conversations/${julien}/drafts/${draft.id}/approve?creatorId=${nora.creatorId}`,
      who.cookie,
      { bubbles: ['Coucou Julien'] },
    );
    expect(approved.statusCode, approved.body).toBe(204);

    // The whole creator stays closed: her mode, her Dashboard.
    const mode = await call(
      'POST',
      `/v1/conversations/${julien}/mode?creatorId=${nora.creatorId}`,
      who.cookie,
      {
        mode: 'copilot',
      },
    );
    expect(mode.json()).toMatchObject({ error: { code: 'creator_forbidden' } });
    const dashboard = await call('GET', `/v1/dashboard?creatorId=${nora.creatorId}&period=day`, who.cookie);
    expect(dashboard.statusCode).toBe(403);
    expect((await call('GET', `/v1/creators/${nora.creatorId}/persona`, who.cookie)).statusCode).toBe(403);

    // His fan's limits are read, never changed.
    const marc = ConversationDetailSchema.parse((await read(conversation('Marc'), who.cookie)).json());
    const flags = `/v1/fans/${marc.fanId}/flags?creatorId=${nora.creatorId}`;
    expect((await call('GET', flags, who.cookie)).statusCode).toBe(200);
    expect((await call('PUT', flags, who.cookie, { flag: 'fragile', set: true })).statusCode).toBe(403);

    // « À traiter » of his creator is his during the shift: Paul's draft has waited for 11 minutes.
    await test.admin.db
      .update(schema.drafts)
      .set({ createdAt: new Date(Date.now() - 11 * MINUTE) })
      .where(
        and(eq(schema.drafts.conversationId, conversation('Paul')), eq(schema.drafts.status, 'pending')),
      );
    const queue = await todos(who.cookie);
    expect(queue.map((todo) => [todo.creatorId, todo.conversationId])).toEqual([
      [nora.creatorId, conversation('Paul')],
    ]);
  });

  it('writes each opening in the audit log, once per quarter of an hour, never what he read', async () => {
    const who = await chatterWith(-60, 60);
    const paul = conversation('Paul');
    for (const path of ['', '/messages', '/events']) {
      const url = `/v1/conversations/${paul}${path}?creatorId=${nora.creatorId}`;
      expect((await call('GET', url, who.cookie)).statusCode).toBe(200);
    }
    expect((await openings(who, paul)).map((row) => row.details)).toEqual([
      { creatorId: nora.creatorId, by: 'chatter' },
    ]);
    // His fan's sheet read on its own is written as the opening of the fan's conversation, once a quarter of an hour.
    const julien = conversation('Julien');
    const sheet = ConversationDetailSchema.parse((await read(julien, ownerCookie)).json());
    const reader = await chatterWith(-60, 60);
    for (const part of ['flags', 'kyc']) {
      const url = `/v1/fans/${sheet.fanId}/${part}?creatorId=${nora.creatorId}`;
      expect((await call('GET', url, reader.cookie)).statusCode, part).toBe(200);
    }
    expect((await openings(reader, julien)).map((row) => row.details)).toEqual([
      { creatorId: nora.creatorId, by: 'chatter', via: 'flags' },
    ]);
    // A conversation he cannot open leaves no trace.
    const outside = await chatterWith(-180, -60);
    expect((await read(paul, outside.cookie)).statusCode).toBe(403);
    expect(await openings(outside, paul)).toEqual([]);
  });

  it('gives back his own hand or a handoff nobody took, never another person’s', async () => {
    const who = await chatterWith(-60, 60);
    const [marc, paul] = [conversation('Marc'), conversation('Paul')];
    const held = async (id: ConversationId, cookie: string) =>
      (await listed(cookie)).find((item) => item.id === id)?.heldBy;

    // The owner took Marc: the chatter reads it as another person's hand and cannot give it back.
    expect((await act(marc, 'takeover', ownerCookie)).statusCode).toBe(204);
    expect(await held(marc, who.cookie)).toBe('other');
    expect(await held(marc, ownerCookie)).toBe('you');
    const refused = await act(marc, 'release', who.cookie);
    expect([refused.statusCode, refused.json()]).toMatchObject([
      403,
      { error: { code: 'conversation_forbidden' } },
    ]);

    // The agent handed Marc over since: nobody holds it, and the one on shift gives it back once he answered.
    await test.admin.db.execute(sql`
      insert into conversation_events (id, creator_id, conversation_id, seq, type, payload, actor, correlation_id)
      select ${newId(EventIdSchema)}::uuid, ${nora.creatorId}::uuid, ${marc}::uuid, max(seq) + 1, 'handoff_requested',
             ${JSON.stringify({ conversationId: marc, cause: 'meeting' })}::jsonb, 'ai', 'seed'
      from conversation_events where conversation_id = ${marc}::uuid`);
    expect(await held(marc, who.cookie)).toBeNull();
    expect((await act(marc, 'release', who.cookie)).statusCode).toBe(204);

    // He takes Paul: his hand, another person's for the owner, who still gives back any.
    expect((await act(paul, 'takeover', who.cookie)).statusCode).toBe(204);
    expect(await held(paul, who.cookie)).toBe('you');
    expect(await held(paul, ownerCookie)).toBe('other');
    expect((await act(paul, 'release', ownerCookie)).statusCode).toBe(204);
  });

  it('closes his creator at the next request once his shift is shortened, but for the hand he still holds', async () => {
    const who = await chatterWith(-60, 60);
    const [julien, paul] = [conversation('Julien'), conversation('Paul')];
    expect((await act(paul, 'takeover', who.cookie)).statusCode).toBe(204);

    // Shortened under way to have ended 20 minutes ago: past the margin, from his next request on.
    const base = Math.floor(Date.now() / MINUTE) * MINUTE;
    await test.admin.db
      .update(schema.shifts)
      .set({ endsAt: new Date(base - 20 * MINUTE) })
      .where(eq(schema.shifts.memberId, who.memberId));
    expect((await me(who)).shiftCreatorIds).toEqual([]);
    expect((await listed(who.cookie)).map((item) => [item.fanDisplayName, item.heldBy])).toEqual([
      ['Paul', 'you'],
    ]);
    expect((await read(julien, who.cookie)).statusCode).toBe(403);
    expect((await read(paul, who.cookie)).statusCode).toBe(200);
    expect(await todos(who.cookie)).toEqual([]);

    // Given back, the conversation leaves him too.
    expect((await act(paul, 'release', who.cookie)).statusCode).toBe(204);
    expect((await read(paul, who.cookie)).statusCode).toBe(403);
    expect(await list(who.cookie)).toEqual([]);
  });

  it('closes his creator at the next request once his shift is cancelled', async () => {
    const who = await chatterWith(-60, 60);
    expect((await read(conversation('Julien'), who.cookie)).statusCode).toBe(200);
    await test.admin.db
      .update(schema.shifts)
      .set({ cancelledAt: new Date() })
      .where(eq(schema.shifts.memberId, who.memberId));
    expect((await read(conversation('Julien'), who.cookie)).statusCode).toBe(403);
  });
});
