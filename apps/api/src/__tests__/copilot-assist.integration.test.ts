import {
  CopilotDraftViewSchema,
  CreatorIdSchema,
  newId,
  PlatformAccountIdSchema,
  type ConversationId,
  type CopilotDraftView,
  type CopilotTrace,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import type { DraftComposer } from '../modules/conversations';
import { buildServer, type Server } from '../server';

import { FIXED_BUBBLES } from './support/composer';
import { testConfig } from './support/config';
import { activateDemoPersona } from './support/persona';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const NO_LOG = { info: () => undefined, warn: () => undefined };
const PASSWORD = 'correct horse battery';

/** A made-up decision (ADR 0010): the paid step 2 of a script at 15 €, offered with the draft. */
const TRACE: CopilotTrace = {
  move: { kind: 'offer_step', priceMinor: 1_500, block: null },
  reasons: [],
  sale: {
    scriptRef: 'script-demo',
    scriptName: 'Soirée de démonstration',
    stepIndex: 1,
    stepCount: 3,
    nextStep: { stepIndex: 1, priceMinor: 1_500 },
    refusedStepIndexes: [],
    offerPending: false,
  },
  saleMoment: { verdict: 'good', conditions: [] },
  desireTrend: 'up',
};

/** The agent's draft with what the code decided, as the real composer gives it: no model, no key. */
const tracedComposer: DraftComposer = {
  compose: () =>
    Promise.resolve({
      kind: 'draft',
      bubbles: FIXED_BUBBLES,
      softViolations: [],
      costUsd: 0,
      copilot: TRACE,
    }),
};

/**
 * What the copilot shows beside the draft (ADR 0141 lot a): the decision kept with the draft when it is written, read
 * back through its schema, and the cuts read live from his limits at each read (§ 9). Invented data only (ADR 0010).
 */
describe('copilot assist (ADR 0141 lot a)', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let ownerCookie: string;
  const nora = { creatorId: newId(CreatorIdSchema), accountId: newId(PlatformAccountIdSchema) };

  const viewOf = async (name: string): Promise<CopilotDraftView> => {
    const response = await server.inject({
      method: 'GET',
      url: `/v1/copilot/conversations/c-${name}/draft`,
      headers: { cookie: ownerCookie, origin: DASHBOARD_ORIGIN },
    });
    expect(response.statusCode).toBe(200);
    return CopilotDraftViewSchema.parse(response.json());
  };

  async function seed(name: string): Promise<ConversationId> {
    const { conversationId } = await app.modules.conversations.ingestMessage({
      creatorId: nora.creatorId,
      platformAccountId: nora.accountId,
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
      { creatorId: nora.creatorId, conversationId, correlationId: 'seed' },
      NO_LOG,
    );
    return conversationId;
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config), { composer: tracedComposer });
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    await test.admin.db.insert(schema.creators).values({
      id: nora.creatorId,
      nameKey: nora.creatorId,
      displayName: 'nora',
      timezone: 'Europe/Paris',
      settings: { copilot: { fanCard: true, drafts: true } },
    });
    await activateDemoPersona(app, nora.creatorId);
    await test.admin.db.insert(schema.platformAccounts).values({
      id: nora.accountId,
      creatorId: nora.creatorId,
      platform: 'reveal',
      handle: 'nora-reveal',
    });
    const owner = { email: 'owner@example.test', name: 'Owner', password: PASSWORD };
    await createOwner(app.auth, app.db.db, owner);
    ownerCookie = await signIn(server, owner.email, owner.password);
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('keeps the decision with the draft and shows its gesture, price and sale, in the code’s words', async () => {
    const conversationId = await seed('Marc');
    const [row] = await test.admin.db
      .select({ policyTrace: schema.drafts.policyTrace })
      .from(schema.drafts)
      .where(eq(schema.drafts.conversationId, conversationId));
    expect(row?.policyTrace).toEqual({ copilot: TRACE });

    const view = await viewOf('Marc');
    if (view.state !== 'ready') throw new Error(`no draft ready: ${view.state}`);
    expect(view.assist).toMatchObject({
      nextMove: { kind: 'offer_step', label: 'Proposer Étape 2 à 15 €', priceMinor: 1_500, block: null },
      sale: {
        script: { name: 'Soirée de démonstration', stepIndex: 1, stepCount: 3 },
        nextStep: { name: 'Étape 2', priceMinor: 1_500 },
      },
      signals: { desireTrend: 'up', followUpDue: false },
      saleMoment: { verdict: 'good', conditions: [] },
      cuts: [],
      buttons: [],
    });
  });

  it('cuts the sale live on his limits: age in doubt, then limits that do not read', async () => {
    const conversationId = await seed('Paul');
    const [conversation] = await test.admin.db
      .select({ fanId: schema.conversations.fanId })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, conversationId));
    if (conversation === undefined) throw new Error('no conversation');
    const setFlags = (flags: unknown) =>
      test.admin.db.update(schema.fans).set({ flags }).where(eq(schema.fans.id, conversation.fanId));

    await setFlags({ ageDisputed: { since: new Date().toISOString(), by: 'policy' } });
    const doubt = await viewOf('Paul');
    expect(doubt.state === 'ready' ? doubt.assist : undefined).toEqual({
      nextMove: null,
      reasons: [],
      sale: null,
      signals: { desireTrend: null, followUpDue: false },
      cuts: ['age_doubt'],
      buttons: [],
      clicksLeftToday: 0,
      saleMoment: null,
    });

    await setFlags({ unknownFlag: true });
    const unread = await viewOf('Paul');
    expect(unread.state === 'ready' ? unread.assist?.cuts : undefined).toEqual(['limits_unread']);
  });
});
