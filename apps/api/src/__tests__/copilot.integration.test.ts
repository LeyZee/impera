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
import { and, eq, schema } from '@impera/db';
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
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_ADMIN_URL: test.adminUrl });
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
});
