import {
  ConversationIdSchema,
  CreatorIdSchema,
  FanIdSchema,
  newId,
  PlatformAccountIdSchema,
} from '@impera/contracts';
import { schema, withAdmin } from '@impera/db';
import { createTestDb, type TestDb } from '@impera/db/testing';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  applyScriptRunEvent,
  openScriptRun,
  type PlatformScriptView,
  type ScriptRunStore,
} from '../../domain/script-run';
import { createDrizzleScriptRunStore } from '../db/script-run-store';

const AT = new Date('2026-11-12T21:00:00.000Z');
const later = (minutes: number): Date => new Date(AT.getTime() + minutes * 60_000);

/** A made-up script (ADR 0010): teasing, then one paid step. */
const SCRIPT: PlatformScriptView = {
  scriptRef: 'script-demo',
  moment: 'night',
  description: 'Soirée de démonstration',
  steps: [
    { kind: 'free', priceMinor: null },
    { kind: 'paid', priceMinor: 1_500 },
  ],
  mediaValidated: true,
  touchesLimits: false,
};

describe('script runs kept per fan (ADR 0098)', () => {
  let test: TestDb;
  let store: ScriptRunStore;
  const creatorId = newId(CreatorIdSchema);
  const otherCreatorId = newId(CreatorIdSchema);
  const conversationId = newId(ConversationIdSchema);
  const otherConversationId = newId(ConversationIdSchema);

  beforeAll(async () => {
    test = await createTestDb(inject('pgSuperuserUrl'));
    store = createDrizzleScriptRunStore(test.app.db);
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
    const opened = await store.open(creatorId, conversationId, openScriptRun(SCRIPT.scriptRef, AT));
    expect(opened?.run.status).toBe('open');
    if (opened === null) return;
    const sent = applyScriptRunEvent(opened.run, SCRIPT, { type: 'step_sent', stepIndex: 0, at: later(1) });
    if (!sent.ok) throw new Error(sent.fault);
    const paid = applyScriptRunEvent(sent.run, SCRIPT, { type: 'step_sent', stepIndex: 1, at: later(2) });
    if (!paid.ok) throw new Error(paid.fault);
    const ignored = applyScriptRunEvent(paid.run, SCRIPT, {
      type: 'fan_message',
      aboutTheStep: false,
      at: later(3),
    });
    if (!ignored.ok) throw new Error(ignored.fault);
    expect(await store.save(creatorId, { ...opened, run: ignored.run })).toBe(true);

    const read = await store.latest(creatorId, conversationId);
    expect(read?.run).toEqual(ignored.run);
    expect(read?.run.steps.map((step) => [step.stepIndex, step.outcome, step.priceMinor])).toEqual([
      [0, 'sent', null],
      [1, 'sent', 1_500],
    ]);
  });

  it('opens no second run while one is open, and a new one once it ended', async () => {
    expect(await store.open(creatorId, conversationId, openScriptRun('script-other', later(4)))).toBeNull();
    const open = await store.latest(creatorId, conversationId);
    if (open === null) throw new Error('no run');
    const refused = applyScriptRunEvent(open.run, SCRIPT, { type: 'refused', at: later(5) });
    if (!refused.ok) throw new Error(refused.fault);
    expect(await store.save(creatorId, { ...open, run: refused.run })).toBe(true);

    // Whether a script was already sent to him is Reveal's history to say (ADR 0018 § 5), not this table's.
    const next = await store.open(creatorId, conversationId, openScriptRun('script-other', later(7)));
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
        id: ended.id,
        conversationId,
        run: { ...record.run, scriptRef: SCRIPT.scriptRef, status: 'open', endedAt: null },
      }),
    ).toBe(false);
  });

  it('keeps each creator to her own runs', async () => {
    await store.open(otherCreatorId, otherConversationId, openScriptRun(SCRIPT.scriptRef, AT));
    expect(await store.latest(creatorId, otherConversationId)).toBeNull();
    expect(await store.latest(otherCreatorId, conversationId)).toBeNull();
  });
});
