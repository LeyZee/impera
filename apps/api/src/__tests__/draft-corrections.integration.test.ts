import {
  CreatorIdSchema,
  DraftCorrectionsViewSchema,
  DraftIdSchema,
  newId,
  PlatformAccountIdSchema,
  UserIdSchema,
  type ConversationId,
  type CreatorId,
  type DraftCorrectionsView,
  type DraftId,
  type PlatformAccountId,
  type UserId,
} from '@impera/contracts';
import { eq, schema, sql } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import { buildServer, type Server } from '../server';

import { FIXED_BUBBLES, fixedComposer } from './support/composer';
import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const NO_LOG = { info: () => undefined, warn: () => undefined };
const OWNER = { email: 'owner@example.test', name: 'Owner', password: 'correct horse battery' };
const OPERATOR = { email: 'manager@example.test', name: 'Manager', password: 'correct horse staple' };

interface Creator {
  readonly creatorId: CreatorId;
  readonly accountId: PlatformAccountId;
}

/**
 * Entraîner › Corrections (trou béant 12): her refused and retouched drafts, read from the journal in her tenant, with
 * why and before/after; the owner's alone (ADR 0092 § 8), and never another creator's lines. Invented data (ADR 0010).
 */
describe('draft corrections (GET /v1/creators/:creatorId/draft-corrections)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerId: UserId;
  let owner: string;
  let operator: string;
  const nora: Creator = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };
  const lina: Creator = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };

  const read = (cookie: string, creatorId: string) =>
    server.inject({
      method: 'GET',
      url: `/v1/creators/${creatorId}/draft-corrections`,
      headers: { cookie, origin: DASHBOARD_ORIGIN },
    });
  const view = async (creatorId: string): Promise<DraftCorrectionsView> => {
    const response = await read(owner, creatorId);
    expect(response.statusCode).toBe(200);
    return DraftCorrectionsViewSchema.parse(response.json());
  };

  /** A fan writes to her and the agent drafts an answer, waiting for a human. */
  async function drafted(
    creator: Creator,
    name: string,
  ): Promise<{ conversationId: ConversationId; draftId: DraftId }> {
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
    const [draft] = await test.admin.db
      .select({ id: schema.drafts.id })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId))
      .orderBy(sql`${schema.drafts.createdAt} desc`)
      .limit(1);
    if (draft === undefined) throw new Error('no draft');
    return { conversationId, draftId: DraftIdSchema.parse(draft.id) };
  }

  const as = (creator: Creator, conversationId: ConversationId) => ({
    creatorId: creator.creatorId,
    conversationId,
    userId: ownerId,
    correlationId: 'test',
  });

  async function seedCreator(creator: Creator, name: string): Promise<void> {
    await test.admin.db.insert(schema.creators).values({
      id: creator.creatorId,
      nameKey: creator.creatorId,
      displayName: name,
      timezone: 'Europe/Paris',
    });
    await activateDemoPersona(app, creator.creatorId);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: creator.accountId,
      creatorId: creator.creatorId,
      platform: 'reveal',
      handle: `${name}-reveal`,
    });
  }

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
    await seedCreator(nora, 'nora');
    await seedCreator(lina, 'lina');
    ownerId = UserIdSchema.parse((await createOwner(app.auth, app.db.db, OWNER)).userId);
    const operatorId = (await createOwner(app.auth, app.db.db, OPERATOR)).userId;
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [nora.creatorId] })
      .where(eq(schema.user.id, operatorId));
    owner = await signIn(server, OWNER.email, OWNER.password);
    operator = await signIn(server, OPERATOR.email, OPERATOR.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('reads her retouches and refusals with why, before and after, newest first', async () => {
    const { conversations } = app.modules;
    const marc = await drafted(nora, 'Marc');
    await conversations.approveDraft({
      ...as(nora, marc.conversationId),
      draftId: marc.draftId,
      bubbles: ['Bonsoir toi'],
    });
    const paul = await drafted(nora, 'Paul');
    await conversations.rejectDraft({
      ...as(nora, paul.conversationId),
      draftId: paul.draftId,
      reason: 'Elle ne dit jamais ça',
    });
    // From the copilot panel: a closed reason and its live rating, on a draft a voice version wrote.
    const theo = await drafted(nora, 'Theo');
    await test.admin.db
      .update(schema.drafts)
      .set({ promptHashes: { voicePrompt: 'voice@test', voiceModel: 'model-test' } })
      .where(eq(schema.drafts.id, theo.draftId));
    await conversations.rejectDraft({
      ...as(nora, theo.conversationId),
      draftId: theo.draftId,
      live: { kind: 'rejected', reason: 'too_long', note: 'Trop de bulles' },
    });
    const elsewhere = await drafted(lina, 'Hugo');
    await conversations.rejectDraft({ ...as(lina, elsewhere.conversationId), draftId: elsewhere.draftId });

    const hers = await view(nora.creatorId);
    expect(hers.items.map((item) => [item.fanDisplayName, item.kind, item.reason, item.note])).toEqual([
      ['Theo', 'rejected', 'too_long', 'Trop de bulles'],
      ['Paul', 'rejected', 'written', 'Elle ne dit jamais ça'],
      ['Marc', 'edited', 'edited', null],
    ]);
    expect(hers.items[2]).toMatchObject({ before: [...FIXED_BUBBLES], after: ['Bonsoir toi'] });
    expect(hers.items[0]).toMatchObject({ before: [...FIXED_BUBBLES], after: null });
    expect(hers.counts).toEqual([
      { reason: 'too_long', count: 1 },
      { reason: 'written', count: 1 },
      { reason: 'edited', count: 1 },
    ]);
    expect(hers.truncated).toBe(false);

    // Another creator's lines never come with hers, and hers never with another's.
    const other = await view(lina.creatorId);
    expect(other.items.map((item) => [item.fanDisplayName, item.reason])).toEqual([['Hugo', 'none']]);
    expect(other.items.some((item) => item.draftId === marc.draftId)).toBe(false);
  });

  it('is the owner’s alone: a manager of her list is refused, and so is a visitor', async () => {
    expect((await read(operator, nora.creatorId)).statusCode).toBe(403);
    expect(
      (await server.inject({ method: 'GET', url: `/v1/creators/${nora.creatorId}/draft-corrections` }))
        .statusCode,
    ).toBe(401);
  });
});
