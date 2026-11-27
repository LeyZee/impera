import {
  CreatorIdSchema,
  MeetingTiersBodySchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type PlatformAccountId,
  type SendResult,
} from '@impera/contracts';
import { eq, schema } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createOwner } from '../auth';
import { createApp, type App } from '../composition-root';
import { createLogger } from '../logger';
import {
  createConversationsModule,
  type ConversationsModule,
  type DraftComposer,
  type OutboundSender,
} from '../modules/conversations';
import { createFansModule } from '../modules/fans';
import { buildServer, type Server } from '../server';

import { testConfig } from './support/config';
import { DASHBOARD_ORIGIN, signIn } from './support/sign-in';

const PASSWORD = 'correct horse battery';
const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};
const NO_LOG = { info: () => undefined, warn: () => undefined };
// Arbitrary durations, chosen only to rise: never a value of the agency.
const MEETING_TIERS = { newFanHours: 3, closeFanHours: 17, veryCloseFanHours: 41 };

const OTHER_TIERS = { goodFromMinor: 1_100, veryGoodFromMinor: 2_300, whaleFromMinor: 4_700 };

type ComposeInput = Parameters<DraftComposer['compose']>[0];

class FakeSender implements OutboundSender {
  sendText(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  sendMedia(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  sendStep(): Promise<SendResult> {
    return Promise.reject(new Error('not used'));
  }
  verifySent(): Promise<{ status: 'not_found' }> {
    return Promise.resolve({ status: 'not_found' });
  }
}

/** Records what it was asked and answers a draft. */
class RecordingComposer implements DraftComposer {
  readonly inputs: ComposeInput[] = [];

  compose(input: ComposeInput): ReturnType<DraftComposer['compose']> {
    this.inputs.push(input);
    return Promise.resolve({ kind: 'draft', bubbles: ['Coucou toi'], softViolations: [], costUsd: 0 });
  }
}

/**
 * Her meeting tiers (guide 26/11) through the real app: the owner alone types them, they land in her settings, and
 * `conversation.respond` hands them to the agent with the fan's figures. Everything is invented (ADR 0010).
 */
describe('PUT /v1/creators/:id/meeting-tiers and the compose input', () => {
  let test: TestDb;
  let app: App;
  let server: Server;
  let creatorId: CreatorId;
  let accountId: PlatformAccountId;
  let counter = 0;
  const cookies = new Map<'owner' | 'manager', string>();

  const call = (who: 'owner' | 'manager', method: 'GET' | 'PUT', payload?: object) =>
    server.inject({
      method,
      url: `/v1/creators/${creatorId}/meeting-tiers`,
      headers: { origin: DASHBOARD_ORIGIN, cookie: cookies.get(who) },
      ...(payload !== undefined && { payload }),
    });

  async function composedFor(conversation: string): Promise<ComposeInput | undefined> {
    const composer = new RecordingComposer();
    const conversations: ConversationsModule = createConversationsModule({
      db: test.app.db,
      adminDb: test.service.db,
      fans: createFansModule({ db: test.app.db, adminDb: test.service.db }),
      sender: new FakeSender(),
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@test', voiceModel: 'model-test' },
      guard: PASS_GUARD,
      composer,
    });
    counter += 1;
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId: accountId,
      platformConversationId: conversation,
      platformFanId: `fan-${conversation}`,
      fanDisplayName: 'Théo',
      message: {
        ref: { platform: 'reveal', id: `mt-${String(counter)}` },
        conversationRef: { platform: 'reveal', id: conversation },
        direction: 'inbound',
        text: 'On se voit quand ?',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'test',
    });
    await conversations.jobs.respond({ creatorId, conversationId, correlationId: 'test' }, NO_LOG);
    return composer.inputs[0];
  }

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const config = testConfig({ DATABASE_URL: test.appUrl, DATABASE_SERVICE_URL: test.serviceUrl });
    app = await createApp(config, createLogger(config));
    server = await buildServer({
      config,
      logger: createLogger(config),
      routes: app.routes,
      readiness: app.readiness,
    });
    creatorId = newId(CreatorIdSchema);
    accountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: 'nora', displayName: 'Nora', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: accountId, creatorId, platform: 'reveal', handle: 'creatrice_rencontre' });
    await createOwner(app.auth, app.db.db, {
      email: 'owner@example.test',
      name: 'Owner',
      password: PASSWORD,
    });
    cookies.set('owner', await signIn(server, 'owner@example.test', PASSWORD));
    const { userId } = await createOwner(app.auth, app.db.db, {
      email: 'manager@example.test',
      name: 'manager',
      password: PASSWORD,
    });
    await test.admin.db
      .update(schema.user)
      .set({ role: 'operator', creatorIds: [creatorId] })
      .where(eq(schema.user.id, userId));
    cookies.set('manager', await signIn(server, 'manager@example.test', PASSWORD));
  });

  afterAll(async () => {
    await server.close();
    await app.shutdown();
    await test.close();
  });

  it('gives none before the owner types them, and no tiers to the agent', async () => {
    const read = await call('owner', 'GET');
    expect(read.statusCode, read.body).toBe(200);
    expect(MeetingTiersBodySchema.parse(read.json())).toEqual({ settings: null });
    const input = await composedFor('mt-before');
    expect(input?.fan).not.toHaveProperty('meetingTiers');
  });

  it('lets the owner alone set them, rising, and keeps the rest of her settings', async () => {
    await test.admin.db
      .update(schema.creators)
      .set({ settings: { fanTiers: OTHER_TIERS } })
      .where(eq(schema.creators.id, creatorId));
    expect((await call('manager', 'PUT', { settings: MEETING_TIERS })).statusCode).toBe(403);
    expect((await call('manager', 'GET')).statusCode).toBe(403);
    const falling = { newFanHours: 17, closeFanHours: 3, veryCloseFanHours: 41 };
    expect((await call('owner', 'PUT', { settings: falling })).statusCode).toBe(400);

    const set = await call('owner', 'PUT', { settings: MEETING_TIERS });
    expect(set.statusCode, set.body).toBe(200);
    expect(MeetingTiersBodySchema.parse((await call('owner', 'GET')).json())).toEqual({
      settings: MEETING_TIERS,
    });
    const [stored] = await test.admin.db
      .select({ settings: schema.creators.settings })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId));
    expect(stored?.settings).toEqual({
      fanTiers: OTHER_TIERS,
      meetingTiers: MEETING_TIERS,
    });
  });

  it('hands her stored tiers to the agent when it answers a fan', async () => {
    const input = await composedFor('mt-after');
    expect(input?.fan.meetingTiers).toEqual(MEETING_TIERS);
  });

  it('removes them with null: the agent gets none again', async () => {
    const cleared = await call('owner', 'PUT', { settings: null });
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(MeetingTiersBodySchema.parse((await call('owner', 'GET')).json())).toEqual({ settings: null });
    const input = await composedFor('mt-cleared');
    expect(input?.fan).not.toHaveProperty('meetingTiers');
  });
});
