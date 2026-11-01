import {
  CreatorIdSchema,
  CustomAlertIdSchema,
  newId,
  PlatformAccountIdSchema,
  type CreatorId,
  type PlatformAccountId,
} from '@nirvana/contracts';
import { eq, schema } from '@nirvana/db';
import { createTestDb, type TestDb } from '@nirvana/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createJobQueue, type JobQueue } from '../../../../../jobs';
import { createFansModule } from '../../../../fans';
import { appendEvent, lockConversation } from '../../../application/journal';
import { createConversationsModule } from '../../../index';
import { createDrizzleUnitOfWork } from '../unit-of-work';

const PASS_GUARD = {
  forCreator: () => Promise.resolve({ check: () => ({ isBlocked: false, codes: [] }) }),
};

/** What the journal copies to the outbox (`domain_events`), where the other modules read it (ADR 0007, ADR 0020). */
describe('the journal’s outbox', () => {
  let test: TestDb;
  let queue: JobQueue;
  let creatorId: CreatorId;
  let platformAccountId: PlatformAccountId;

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    // Creates Graphile's schema, which a new message enqueues its answer into.
    queue = await createJobQueue(test.admin.pool);
    creatorId = newId(CreatorIdSchema);
    platformAccountId = newId(PlatformAccountIdSchema);
    await test.admin.db
      .insert(schema.creators)
      .values({ id: creatorId, nameKey: creatorId, displayName: 'Démo', timezone: 'Europe/Paris' });
    await test.admin.db
      .insert(schema.platformAccounts)
      .values({ id: platformAccountId, creatorId, platform: 'reveal', handle: 'test' });
  });

  afterAll(async () => {
    await queue.close();
    await test.close();
  });

  it('publishes an alert that only lets a human know, for Telegram (P4-01)', async () => {
    const conversations = createConversationsModule({
      db: test.app.db,
      fans: createFansModule({ db: test.app.db, adminDb: test.admin.db }),
      sender: {
        sendText: () => Promise.reject(new Error('not used')),
        sendMedia: () => Promise.reject(new Error('not used')),
        verifySent: () => Promise.resolve({ status: 'not_found' }),
      },
      requireRole: () => () => Promise.resolve(),
      recentLogin: () => Promise.resolve(),
      voice: { voicePrompt: 'voice@journal', voiceModel: 'model-journal' },
      guard: PASS_GUARD,
    });
    const { conversationId } = await conversations.ingestMessage({
      creatorId,
      platformAccountId,
      platformConversationId: 'c-journal',
      platformFanId: 'fan-journal',
      fanDisplayName: 'Julien',
      message: {
        ref: { platform: 'reveal', id: 'm-journal' },
        conversationRef: { platform: 'reveal', id: 'c-journal' },
        direction: 'inbound',
        text: 'texte du fan',
        media: [],
        priceMinor: null,
        currency: null,
        isPaid: false,
        createdAt: new Date().toISOString(),
      },
      correlationId: 'journal',
    });

    const payload = {
      conversationId,
      trigger: { alert: { kind: 'custom', id: newId(CustomAlertIdSchema) }, matchedBy: 'model' },
      notify: true,
    } as const;
    await createDrizzleUnitOfWork(test.app.db).inTenant(creatorId, async (tx) => {
      const conversation = await lockConversation(tx, conversationId);
      await appendEvent(
        tx,
        conversation,
        { type: 'alert_triggered', payload },
        { actor: 'ai', correlationId: 'journal', at: new Date() },
      );
    });

    const outbox = await test.admin.db
      .select({ type: schema.domainEvents.type, payload: schema.domainEvents.payload })
      .from(schema.domainEvents)
      .where(eq(schema.domainEvents.type, 'alert_triggered'));
    expect(outbox).toEqual([{ type: 'alert_triggered', payload }]);
  });
});
