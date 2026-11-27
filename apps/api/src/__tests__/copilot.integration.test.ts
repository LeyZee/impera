import {
  CopilotDraftViewSchema,
  CopilotSwitchesSchema,
  CopilotVerdictResultSchema,
  CreatorIdSchema,
  ExtensionLinkCreatedSchema,
  newId,
  PlatformAccountIdSchema,
  ShiftIdSchema,
  TeamMemberIdSchema,
  type ConversationId,
  type CopilotDraftView,
  type CreatorId,
  type DraftId,
} from '@impera/contracts';
import { and, eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { z } from 'zod';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { FIXED_BUBBLES, fixedComposer } from './support/composer';
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
 * The copilot panel's API (ADR 0086 lot a): the draft read next to the conversation open on the platform, with the
 * dashboard's session and only on shift; the chatter's gesture written with his extension link, once per draft; a
 * rejection's `live` rating. Nothing is sent to anyone: the chatter sends himself. Invented data only (ADR 0010).
 */
describe('copilot panel (ADR 0086)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: string;
  let ownerCookie: string;
  let members = 0;
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const ines = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };

  const codeOf = (response: { json: () => unknown }): string =>
    z.object({ error: z.object({ code: z.string() }) }).parse(response.json()).error.code;

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: object) =>
    server.inject({
      method,
      url,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
      ...(payload === undefined ? {} : { payload }),
    });

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

  /** A chatter of Nora (scope `self`), signed in, with a shift on her from `from` to `to` minutes from now, if any. */
  async function chatter(window?: { from: number; to: number }): Promise<Member> {
    members += 1;
    const email = `chatter-${String(members)}@example.test`;
    const { userId } = await createOwner(app.auth, app.db.db, { email, name: 'chatter', password: PASSWORD });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [nora.creatorId] })
      .where(eq(schema.user.id, userId));
    const memberId = newId(TeamMemberIdSchema);
    await test.admin.db.insert(schema.teamMembers).values({
      id: memberId,
      userId,
      teamRole: 'chatter',
      firstName: 'Prénom',
      lastName: 'Inventé',
      displayName: `chatter ${String(members)}`,
      country: 'BJ',
      timeZone: 'Africa/Porto-Novo',
      joinedOn: '2026-10-01',
    });
    if (window !== undefined) {
      const accountId = newId(PlatformAccountIdSchema);
      await test.admin.db.insert(schema.platformAccounts).values({
        id: accountId,
        creatorId: nora.creatorId,
        platform: 'reveal',
        handle: `shift-${accountId}`,
      });
      const base = Math.floor(Date.now() / MINUTE) * MINUTE;
      await test.admin.db.insert(schema.shifts).values({
        id: newId(ShiftIdSchema),
        creatorId: nora.creatorId,
        platformAccountId: accountId,
        memberId,
        startsAt: new Date(base + window.from * MINUTE),
        endsAt: new Date(base + window.to * MINUTE),
        createdBy: ownerId,
        updatedBy: ownerId,
      });
    }
    return { userId, memberId, cookie: await signIn(server, email, PASSWORD) };
  }

  const draftOf = async (
    name: string,
    cookie: string,
    query = '',
  ): Promise<{ status: number; view: CopilotDraftView | null; code: string | null }> => {
    const response = await call('GET', `/v1/copilot/conversations/c-${name}/draft${query}`, cookie);
    return response.statusCode === 200
      ? { status: 200, view: CopilotDraftViewSchema.parse(response.json()), code: null }
      : { status: response.statusCode, view: null, code: codeOf(response) };
  };

  const readyDraft = async (name: string, cookie: string) => {
    const { view } = await draftOf(name, cookie);
    if (view?.state !== 'ready') throw new Error(`no draft ready for ${name}: ${JSON.stringify(view)}`);
    return view;
  };

  const linkOf = async (cookie: string): Promise<string> => {
    const response = await call('POST', '/v1/trends/extension-links', cookie, { label: 'Panneau' });
    expect(response.statusCode).toBe(201);
    return ExtensionLinkCreatedSchema.parse(response.json()).token;
  };

  const gesture = (draftId: DraftId, payload: object, token: string | null, cookie?: string) =>
    server.inject({
      method: 'POST',
      url: `/v1/copilot/drafts/${draftId}/verdict`,
      headers: {
        ...(token === null ? {} : { 'x-extension-link': token }),
        ...(cookie === undefined ? {} : { cookie, origin: DASHBOARD_ORIGIN }),
      },
      payload,
    });

  const draftRow = async (draftId: DraftId) => {
    const [row] = await test.admin.db
      .select({
        status: schema.drafts.status,
        placedBy: schema.drafts.placedBy,
        placedAt: schema.drafts.placedAt,
      })
      .from(schema.drafts)
      .where(eq(schema.drafts.id, draftId));
    return row;
  };

  const ratingsOf = (draftId: DraftId) =>
    test.admin.db
      .select()
      .from(schema.calibrationRatings)
      .where(eq(schema.calibrationRatings.draftId, draftId));

  const setSwitches = (creatorId: CreatorId, payload: object, cookie = ownerCookie) =>
    call('PUT', `/v1/creators/${creatorId}/copilot`, cookie, payload);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config), { composer: fixedComposer });
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
    for (const name of ['Julien', 'Marc', 'Paul', 'Theo']) await seed(nora, name);
    await seed(ines, 'Hugo');
    const owner = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
    ({ userId: ownerId } = await createOwner(app.auth, app.db.db, owner));
    ownerCookie = await signIn(server, owner.email, owner.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('says when Impera has not read the conversation, and shows no draft while her drafts are off', async () => {
    expect((await draftOf('inconnue', ownerCookie)).view).toEqual({ state: 'unknown' });
    const off = await draftOf('Julien', ownerCookie);
    expect(off.view).toMatchObject({
      state: 'off',
      conversation: { creatorId: nora.creatorId, switches: { fanCard: true, drafts: false } },
    });
    // The owner finds it among all her creators, or by naming her.
    expect((await draftOf('Hugo', ownerCookie, `?creatorId=${ines.creatorId}`)).view?.state).toBe('off');
    expect((await draftOf('Hugo', ownerCookie, `?creatorId=${nora.creatorId}`)).view).toEqual({
      state: 'unknown',
    });
  });

  // Recette du 16/11: calm since before the account's first poll, the conversation was in no list Impera read.
  it('asks the platform for a conversation it never read, once a minute at most, on her readable accounts', async () => {
    const reads = async () =>
      z.array(z.object({ key: z.string(), queue_name: z.string().nullable() })).parse(
        (
          await test.admin.db.execute(
            sql`select j.key, q.queue_name from graphile_worker._private_jobs j
                  left join graphile_worker._private_job_queues q on q.id = j.job_queue_id
                  where j.key like 'read:%'`,
          )
        ).rows,
      );
    // An account whose session cannot be read is never asked.
    expect((await draftOf('jamais-lue', ownerCookie)).view).toEqual({ state: 'unknown' });
    expect(await reads()).toEqual([]);

    await test.admin.db
      .update(schema.platformAccounts)
      .set({ sessionState: 'valid' })
      .where(eq(schema.platformAccounts.id, nora.accountId));
    try {
      expect((await draftOf('jamais-lue-2', ownerCookie)).view).toEqual({ state: 'unknown' });
      expect((await draftOf('jamais-lue-2', ownerCookie)).view).toEqual({ state: 'unknown' });
      expect(await reads()).toEqual([
        { key: `read:${nora.accountId}:c-jamais-lue-2`, queue_name: `account:${nora.accountId}` },
      ]);
    } finally {
      await test.admin.db
        .update(schema.platformAccounts)
        .set({ sessionState: 'none' })
        .where(eq(schema.platformAccounts.id, nora.accountId));
      await test.admin.db.execute(sql`delete from graphile_worker._private_jobs where key like 'read:%'`);
    }
  });

  it('lets the owner turn her switches, one at a time, audited, and nobody else', async () => {
    const read = await call('GET', `/v1/creators/${nora.creatorId}/copilot`, ownerCookie);
    expect(CopilotSwitchesSchema.parse(read.json())).toEqual({ fanCard: true, drafts: false });
    expect((await setSwitches(nora.creatorId, {})).statusCode).toBe(400);
    const on = await setSwitches(nora.creatorId, { drafts: true });
    expect(CopilotSwitchesSchema.parse(on.json())).toEqual({ fanCard: true, drafts: true });
    // Her other settings stay as stored: only her `copilot` key is written.
    const [stored] = await test.admin.db
      .select({ settings: schema.creators.settings })
      .from(schema.creators)
      .where(eq(schema.creators.id, nora.creatorId));
    expect(stored?.settings).toEqual({ copilot: { fanCard: true, drafts: true } });
    const audits = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'creator.copilot_switches'),
          eq(schema.auditLog.entityId, nora.creatorId),
        ),
      );
    expect(audits.map((row) => row.details)).toEqual([
      { from: { fanCard: true, drafts: false }, to: { fanCard: true, drafts: true } },
    ]);
    const someone = await chatter({ from: -30, to: 60 });
    expect((await setSwitches(nora.creatorId, { drafts: false }, someone.cookie)).statusCode).toBe(403);
  });

  it('shows the draft with its bubbles to the owner, and to a chatter only on shift, his opening audited once', async () => {
    const ready = await readyDraft('Marc', ownerCookie);
    expect(ready.draft).toMatchObject({ bubbles: [...FIXED_BUBBLES], placedAt: null });

    const away = await chatter();
    const refused = await draftOf('Marc', away.cookie);
    expect([refused.status, refused.code]).toEqual([403, 'copilot_shift_forbidden']);

    const onShift = await chatter({ from: -30, to: 60 });
    expect((await readyDraft('Marc', onShift.cookie)).draft.draftId).toBe(ready.draft.draftId);
    await readyDraft('Marc', onShift.cookie);
    const openings = await test.admin.db
      .select({ details: schema.auditLog.details })
      .from(schema.auditLog)
      .where(
        and(eq(schema.auditLog.userId, onShift.userId), eq(schema.auditLog.action, 'conversation.open')),
      );
    expect(openings.map((row) => row.details)).toEqual([
      { creatorId: nora.creatorId, by: 'chatter', via: 'copilot' },
    ]);
    // Never another creator's: named, 403 at once; not named, she is not looked in.
    const other = await draftOf('Hugo', onShift.cookie, `?creatorId=${ines.creatorId}`);
    expect([other.status, other.code]).toEqual([403, 'creator_forbidden']);
    expect((await draftOf('Hugo', onShift.cookie)).view).toEqual({ state: 'unknown' });
  });

  it('records a placing with the link once, and the draft stays pending until what left decides', async () => {
    const onShift = await chatter({ from: -30, to: 60 });
    const token = await linkOf(onShift.cookie);
    const { draft } = await readyDraft('Paul', onShift.cookie);
    const placed = { kind: 'placed', creatorId: nora.creatorId, edited: false };

    // The cookie never writes: the link is the key.
    const cookieOnly = await gesture(draft.draftId, placed, null, onShift.cookie);
    expect([cookieOnly.statusCode, codeOf(cookieOnly)]).toEqual([401, 'extension_link_unauthenticated']);
    const wrong = await gesture(draft.draftId, placed, 'A'.repeat(43));
    expect(wrong.statusCode).toBe(401);

    const first = await gesture(draft.draftId, placed, token);
    expect(CopilotVerdictResultSchema.parse(first.json())).toEqual({
      draftId: draft.draftId,
      outcome: 'placed',
      replayed: false,
    });
    const again = await gesture(draft.draftId, { ...placed, edited: true }, token);
    expect(CopilotVerdictResultSchema.parse(again.json()).replayed).toBe(true);
    expect(await draftRow(draft.draftId)).toMatchObject({ status: 'pending', placedBy: onShift.userId });
    expect((await readyDraft('Paul', onShift.cookie)).draft.placedAt).not.toBeNull();
    expect(await ratingsOf(draft.draftId)).toEqual([]);

    // His link opens no door of the watch (ADR 0060 § 2).
    const watch = await server.inject({
      method: 'GET',
      url: '/v1/trends/readings/creators',
      headers: { 'x-extension-link': token },
    });
    expect([watch.statusCode, codeOf(watch)]).toEqual([403, 'trend_watch_forbidden']);
  });

  it('rejects with a reason, writes one live rating without his words, and replays without writing again', async () => {
    const onShift = await chatter({ from: -30, to: 60 });
    const token = await linkOf(onShift.cookie);
    const { draft } = await readyDraft('Theo', onShift.cookie);
    // The version that wrote it, as the engine stamps it: the fixed composer of the tests names none.
    await test.admin.db
      .update(schema.drafts)
      .set({ promptHashes: { voicePrompt: 'voice@test', voiceModel: 'model-test' } })
      .where(eq(schema.drafts.id, draft.draftId));
    const rejected = {
      kind: 'rejected',
      creatorId: nora.creatorId,
      reason: 'too_long',
      note: 'Trop de bulles',
    };

    expect(
      (await gesture(draft.draftId, { kind: 'placed', creatorId: nora.creatorId, edited: true }, token))
        .statusCode,
    ).toBe(200);
    const first = await gesture(draft.draftId, rejected, token);
    expect(CopilotVerdictResultSchema.parse(first.json())).toEqual({
      draftId: draft.draftId,
      outcome: 'rejected',
      replayed: false,
    });
    expect(
      CopilotVerdictResultSchema.parse((await gesture(draft.draftId, rejected, token)).json()).replayed,
    ).toBe(true);
    expect((await draftRow(draft.draftId))?.status).toBe('rejected');

    const ratings = await ratingsOf(draft.draftId);
    expect(ratings).toHaveLength(1);
    expect(ratings[0]).toMatchObject({
      creatorId: nora.creatorId,
      source: 'live',
      sessionId: null,
      fanMessage: null,
      moment: null,
      verdictKind: 'rejected',
      voicePrompt: 'voice@test',
      voiceModel: 'model-test',
      verdict: { kind: 'rejected', reason: 'too_long', note: 'Trop de bulles' },
      bubbles: [...FIXED_BUBBLES],
    });

    // Rejected, it is never placed afterwards.
    const late = await gesture(
      draft.draftId,
      { kind: 'placed', creatorId: nora.creatorId, edited: false },
      token,
    );
    expect([late.statusCode, codeOf(late)]).toEqual([409, 'copilot_draft_conflict']);
  });

  it('refuses a gesture off shift, on another creator, or on a draft she does not have', async () => {
    const owner = await linkOf(ownerCookie);
    const { draft } = await readyDraft('Julien', ownerCookie);
    const away = await chatter();
    const awayToken = await linkOf(away.cookie);
    const placed = { kind: 'placed', creatorId: nora.creatorId, edited: false };

    const offShift = await gesture(draft.draftId, placed, awayToken);
    expect([offShift.statusCode, codeOf(offShift)]).toEqual([403, 'copilot_shift_forbidden']);
    const elsewhere = await gesture(draft.draftId, { ...placed, creatorId: ines.creatorId }, awayToken);
    expect([elsewhere.statusCode, codeOf(elsewhere)]).toEqual([403, 'creator_forbidden']);
    // Her draft named under another creator is not found: RLS reads only that creator's.
    const misplaced = await gesture(draft.draftId, { ...placed, creatorId: ines.creatorId }, owner);
    expect([misplaced.statusCode, codeOf(misplaced)]).toEqual([404, 'draft_not_found']);
    expect((await gesture(draft.draftId, placed, owner)).statusCode).toBe(200);
  });

  describe('what left decides the placed draft (ADR 0086 § 5)', () => {
    let sends = 0;
    /** A message of the creator's side read on the platform, as the connector reports one a chatter sent. */
    const sentOnReveal = (name: string, text: string, createdAt = new Date()) => {
      sends += 1;
      return app.modules.conversations.ingestMessage({
        creatorId: nora.creatorId,
        platformAccountId: nora.accountId,
        platformConversationId: `c-${name}`,
        platformFanId: `f-${name}`,
        fanDisplayName: name,
        message: {
          ref: { platform: 'reveal', id: `out-${name}-${String(sends)}` },
          conversationRef: { platform: 'reveal', id: `c-${name}` },
          direction: 'outbound',
          text,
          media: [],
          priceMinor: null,
          currency: null,
          isPaid: false,
          createdAt: createdAt.toISOString(),
        },
        correlationId: 'reveal',
      });
    };

    /** A fresh conversation with her draft, stamped with the voice that wrote it (the live rate reads it), placed. */
    const placedDraft = async (name: string, onShift: Member, token: string) => {
      const conversationId = await seed(nora, name);
      const { draft } = await readyDraft(name, onShift.cookie);
      await test.admin.db
        .update(schema.drafts)
        .set({ promptHashes: { voicePrompt: 'voice@test', voiceModel: 'model-test' } })
        .where(eq(schema.drafts.id, draft.draftId));
      const placed = await gesture(
        draft.draftId,
        { kind: 'placed', creatorId: nora.creatorId, edited: false },
        token,
      );
      expect(placed.statusCode).toBe(200);
      return { conversationId, draftId: draft.draftId };
    };

    const settled = async (draftId: DraftId) => {
      const [row] = await test.admin.db
        .select({ status: schema.drafts.status, finalBubbles: schema.drafts.finalBubbles })
        .from(schema.drafts)
        .where(eq(schema.drafts.id, draftId));
      const ratings = await ratingsOf(draftId);
      return { ...row, ratings: ratings.map((rating) => [rating.source, rating.verdict]) };
    };
    const stateOf = async (conversationId: ConversationId) => {
      const [row] = await test.admin.db
        .select({ state: schema.conversations.state })
        .from(schema.conversations)
        .where(eq(schema.conversations.id, conversationId));
      return row?.state;
    };
    const linkedTo = async (draftId: DraftId) =>
      (
        await test.admin.db
          .select({ text: schema.messages.text, author: schema.messages.author })
          .from(schema.messages)
          .where(eq(schema.messages.draftId, draftId))
      ).map((message) => [message.author, message.text]);
    const queued = async (key: string) =>
      z.array(z.object({ in_minutes: z.number() })).parse(
        (
          await test.admin.db.execute(
            sql`select round(extract(epoch from run_at - now()) / 60)::int as in_minutes
                    from graphile_worker._private_jobs where key = ${key}`,
          )
        ).rows,
      );
    const sendsOf = async (draftId: DraftId) =>
      (
        await test.admin.db.execute(
          sql`select 1 from graphile_worker._private_jobs j
                join graphile_worker._private_tasks t on t.id = j.task_id
                where t.identifier = 'conversation.send' and j.payload->>'draftId' = ${draftId}`,
        )
      ).rows.length;
    const settle = (conversationId: ConversationId, draftId: DraftId) =>
      app.modules.conversations.jobs.settlePlaced({
        creatorId: nora.creatorId,
        conversationId,
        draftId,
        correlationId: 'settle',
      });

    it('validates the draft sent as it was, bubble after bubble, rated live, and sends nothing after it', async () => {
      const onShift = await chatter({ from: -30, to: 60 });
      const token = await linkOf(onShift.cookie);
      const { conversationId, draftId } = await placedDraft('Lea', onShift, token);
      // Its window is scheduled once: after 15 minutes, and what the connector takes to read what left.
      expect(await queued(`conversation.settle_placed:${draftId}`)).toEqual([{ in_minutes: 17 }]);

      await sentOnReveal('Lea', FIXED_BUBBLES[0]);
      // The fan is answered, and the draft waits for its other bubble: the panel still shows it.
      expect(await stateOf(conversationId)).toBe('idle');
      expect((await settled(draftId)).status).toBe('pending');
      expect((await readyDraft('Lea', onShift.cookie)).draft.draftId).toBe(draftId);

      await sentOnReveal('Lea', ` ${FIXED_BUBBLES[1]}`);
      expect(await settled(draftId)).toEqual({
        status: 'sent',
        finalBubbles: null,
        ratings: [['live', { kind: 'validated' }]],
      });
      expect(await linkedTo(draftId)).toEqual([
        ['human', FIXED_BUBBLES[0]],
        ['human', ` ${FIXED_BUBBLES[1]}`],
      ]);
      expect(await stateOf(conversationId)).toBe('idle');
      expect(await sendsOf(draftId)).toBe(0);
      const [event] = await test.admin.db
        .select({ type: schema.conversationEvents.type, payload: schema.conversationEvents.payload })
        .from(schema.conversationEvents)
        .where(
          and(
            eq(schema.conversationEvents.conversationId, conversationId),
            eq(schema.conversationEvents.type, 'draft_approved'),
          ),
        );
      expect(event?.payload).toMatchObject({
        draftId,
        status: 'approved',
        decidedBy: onShift.userId,
        sentOnPlatform: true,
      });
      expect((await draftOf('Lea', onShift.cookie)).view?.state).toBe('none');

      // Its window closing later changes nothing.
      await settle(conversationId, draftId);
      expect((await settled(draftId)).ratings).toHaveLength(1);
    });

    it('corrects the draft with the text really sent when a word changed', async () => {
      const onShift = await chatter({ from: -30, to: 60 });
      const token = await linkOf(onShift.cookie);
      const { draftId } = await placedDraft('Mila', onShift, token);

      await sentOnReveal('Mila', 'Coucou mon cœur ✨');
      await sentOnReveal('Mila', FIXED_BUBBLES[1]);
      expect(await settled(draftId)).toEqual({
        status: 'sent',
        finalBubbles: ['Coucou mon cœur ✨', FIXED_BUBBLES[1]],
        ratings: [['live', { kind: 'corrected', text: `Coucou mon cœur ✨\n${FIXED_BUBBLES[1]}` }]],
      });
    });

    it('settles at its window what left of it, and expires a draft nothing left of', async () => {
      const onShift = await chatter({ from: -30, to: 60 });
      const token = await linkOf(onShift.cookie);
      const half = await placedDraft('Nael', onShift, token);
      await sentOnReveal('Nael', FIXED_BUBBLES[0]);
      await settle(half.conversationId, half.draftId);
      expect(await settled(half.draftId)).toEqual({
        status: 'sent',
        finalBubbles: [FIXED_BUBBLES[0]],
        ratings: [['live', { kind: 'corrected', text: FIXED_BUBBLES[0] }]],
      });

      const kept = await placedDraft('Owen', onShift, token);
      await settle(kept.conversationId, kept.draftId);
      expect(await settled(kept.draftId)).toEqual({ status: 'expired', finalBubbles: null, ratings: [] });
      expect(await stateOf(kept.conversationId)).toBe('idle');
    });

    it('decides a half-sent draft when the fan writes again, and never reads a message of another time as it', async () => {
      const onShift = await chatter({ from: -30, to: 60 });
      const token = await linkOf(onShift.cookie);
      const { draftId } = await placedDraft('Pia', onShift, token);
      await sentOnReveal('Pia', FIXED_BUBBLES[0]);
      // His answer comes before the second bubble left: what left decides it.
      await app.modules.conversations.ingestMessage({
        creatorId: nora.creatorId,
        platformAccountId: nora.accountId,
        platformConversationId: 'c-Pia',
        platformFanId: 'f-Pia',
        fanDisplayName: 'Pia',
        message: {
          ref: { platform: 'reveal', id: 'm-Pia-2' },
          conversationRef: { platform: 'reveal', id: 'c-Pia' },
          direction: 'inbound',
          text: 'Rien de spécial',
          media: [],
          priceMinor: null,
          currency: null,
          isPaid: false,
          createdAt: new Date().toISOString(),
        },
        correlationId: 'reveal',
      });
      expect(await settled(draftId)).toMatchObject({ status: 'sent', finalBubbles: [FIXED_BUBBLES[0]] });

      // Sent twenty minutes after the placing: someone's own words, the draft falls as before.
      const late = await placedDraft('Rae', onShift, token);
      await sentOnReveal('Rae', FIXED_BUBBLES[0], new Date(Date.now() + 20 * MINUTE));
      expect(await settled(late.draftId)).toEqual({ status: 'expired', finalBubbles: null, ratings: [] });
      expect(await linkedTo(late.draftId)).toEqual([]);
    });
  });
});
