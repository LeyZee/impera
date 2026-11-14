import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
  ScriptRunIdSchema,
  type ConversationId,
  type CreatorId,
} from '@impera/contracts';
import { schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import type { ScriptRunState, StoredScriptRun } from '../../../domain/ports';
import { createDrizzleUnitOfWork } from '../unit-of-work';

const AT = new Date('2026-11-12T21:00:00.000Z');
const later = (minutes: number): Date => new Date(AT.getTime() + minutes * 60_000);

const opening = (scriptRef: string, at: Date): ScriptRunState => ({
  scriptRef,
  status: 'open',
  steps: [],
  ignoredMessages: 0,
  startedAt: at,
  endedAt: null,
});

/** A made-up run (ADR 0010): the teasing sent, then a paid step he ignored once. */
const step = (stepIndex: number, minutes: number, priceMinor: number | null) =>
  ({
    stepIndex,
    kind: priceMinor === null ? 'free' : 'paid',
    outcome: 'sent',
    priceMinor,
    sentAt: later(minutes),
    at: later(minutes),
  }) as const;

/** `script_runs` through the turn's transaction, one per call. */
interface Store {
  latest(creatorId: CreatorId, conversationId: ConversationId): Promise<StoredScriptRun | null>;
  open(
    creatorId: CreatorId,
    conversationId: ConversationId,
    run: ScriptRunState,
  ): Promise<StoredScriptRun | null>;
  save(creatorId: CreatorId, stored: StoredScriptRun): Promise<boolean>;
}

describe('script runs kept per fan (ADR 0098)', () => {
  let test: TestDb;
  let store: Store;
  const creatorId = newId(CreatorIdSchema);
  const otherCreatorId = newId(CreatorIdSchema);
  const conversationId = newId(ConversationIdSchema);
  const otherConversationId = newId(ConversationIdSchema);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    const uow = createDrizzleUnitOfWork(test.app.db);
    store = {
      latest: (creator, conversation) => uow.inTenant(creator, (tx) => tx.scriptRuns.latest(conversation)),
      open: (creator, conversation, run) =>
        uow.inTenant(creator, (tx) => tx.scriptRuns.open(conversation, run)),
      save: (creator, stored) => uow.inTenant(creator, (tx) => tx.scriptRuns.save(stored)),
    };
    // Two invented creators, one fan each (ADR 0010).
    await withAdmin(test.admin.db, async (tx) => {
      for (const [creator, conversation, name] of [
        [creatorId, conversationId, 'Anna'],
        [otherCreatorId, otherConversationId, 'Léa'],
      ] as const) {
        const accountId = newId(PlatformAccountIdSchema);
        const fanId = newId(FanIdSchema);
        await tx
          .insert(schema.creators)
          .values({ id: creator, nameKey: creator, displayName: name, timezone: 'Europe/Paris' });
        await tx
          .insert(schema.platformAccounts)
          .values({ id: accountId, creatorId: creator, platform: 'reveal', handle: `${name}-demo` });
        await tx.insert(schema.fans).values({
          id: fanId,
          creatorId: creator,
          platformAccountId: accountId,
          platformFanId: 'fan-1',
          displayName: 'Basile',
        });
        await tx.insert(schema.conversations).values({
          id: conversation,
          creatorId: creator,
          platformAccountId: accountId,
          fanId,
          platformConversationId: 'conv-1',
        });
      }
    });
  });

  afterAll(async () => {
    await test.close();
  });

  it('opens a run, keeps its steps as they move, and reads it back', async () => {
    expect(await store.latest(creatorId, conversationId)).toBeNull();
    const opened = await store.open(creatorId, conversationId, opening('script-demo', AT));
    expect(opened?.run.status).toBe('open');
    if (opened === null) return;
    const ignored: ScriptRunState = {
      ...opened.run,
      steps: [step(0, 1, null), step(1, 2, 1_500)],
      ignoredMessages: 1,
    };
    expect(await store.save(creatorId, { ...opened, run: ignored })).toBe(true);

    const read = await store.latest(creatorId, conversationId);
    expect(read?.run).toEqual(ignored);
    expect(read?.run.steps.map((step) => [step.stepIndex, step.outcome, step.priceMinor])).toEqual([
      [0, 'sent', null],
      [1, 'sent', 1_500],
    ]);
  });

  it('opens no second run while one is open, and a new one once it ended', async () => {
    expect(await store.open(creatorId, conversationId, opening('script-other', later(4)))).toBeNull();
    const open = await store.latest(creatorId, conversationId);
    if (open === null) throw new Error('no run');
    const refused: ScriptRunState = { ...open.run, status: 'refused', ignoredMessages: 0, endedAt: later(5) };
    expect(await store.save(creatorId, { ...open, run: refused })).toBe(true);

    // Whether a script was already sent to him is Reveal's history to say (ADR 0018 § 5), not this table's.
    const next = await store.open(creatorId, conversationId, opening('script-other', later(7)));
    expect(next?.run.scriptRef).toBe('script-other');
    expect((await store.latest(creatorId, conversationId))?.run.scriptRef).toBe('script-other');
  });

  it('never changes a run once it ended', async () => {
    const runs = await withAdmin(test.admin.db, (tx) => tx.select().from(schema.scriptRuns));
    const ended = runs.find((row) => row.status === 'refused');
    if (ended === undefined) throw new Error('no ended run');
    const record = await store.latest(creatorId, conversationId);
    if (record === null) throw new Error('no run');
    expect(
      await store.save(creatorId, {
        id: ScriptRunIdSchema.parse(ended.id),
        run: { ...record.run, scriptRef: 'script-demo', status: 'open', endedAt: null },
      }),
    ).toBe(false);
  });

  it('keeps each creator to her own runs', async () => {
    await store.open(otherCreatorId, otherConversationId, opening('script-demo', AT));
    expect(await store.latest(creatorId, otherConversationId)).toBeNull();
    expect(await store.latest(otherCreatorId, conversationId)).toBeNull();
  });
});
