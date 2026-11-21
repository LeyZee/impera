import {
  ConversationIdSchema,
  CreatorIdSchema,
  DomainError,
  DraftIdSchema,
  FanIdSchema,
  PlatformAccountIdSchema,
  type DraftStatus,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { SendRefused } from '../../../domain/errors';
import type {
  Conversation,
  Draft,
  DraftDecision,
  OutboundSender,
  Transaction,
  UnitOfWork,
} from '../../../domain/ports';
import { INITIAL_PROJECTION } from '../../../domain/projection';
import { MAX_SEND_ATTEMPTS } from '../../../domain/state-machine';
import { createSendJob } from '../send';

/**
 * The send job against a transaction kept in memory: only what a send of one bubble reads and writes. Everything
 * else throws, so a send that reaches for more fails the test.
 */

const now = new Date('2026-11-20T21:00:00Z');
const unused = (): Promise<never> => Promise.reject(new Error('not used by a send'));

const conversation: Conversation = {
  ...INITIAL_PROJECTION,
  id: ConversationIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1'),
  creatorId: CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c2'),
  platformAccountId: PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c3'),
  fanId: FanIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c4'),
  platformConversationId: 'conv_01',
  state: 'sending',
  lastInboundAt: new Date('2026-11-20T20:58:00Z'),
};

const draft: Draft = {
  id: DraftIdSchema.parse('0199f2a0-0000-7000-8000-0000000000d1'),
  conversationId: conversation.id,
  status: 'approved',
  bubbles: ['coucou toi'],
  finalBubbles: null,
  createdAt: new Date('2026-11-20T20:59:00Z'),
  facts: [],
  scriptStep: null,
  placed: null,
};

interface StatusChange {
  readonly status: DraftStatus;
  readonly decision: DraftDecision | undefined;
}

function world(send: OutboundSender['sendText']) {
  const changes: StatusChange[] = [];
  const failures: { readonly error: string; readonly isFinal: boolean | undefined }[] = [];
  let current: Conversation = conversation;
  const tx: Transaction = {
    conversations: {
      lockOrCreate: unused,
      lock: () => Promise.resolve(current),
      saveProjection: (_id, projection) => {
        current = { ...current, ...projection };
        return Promise.resolve();
      },
      idsInMode: unused,
      idsInState: unused,
      idOfFan: unused,
      isHeldBy: unused,
    },
    messages: {
      insertIfNew: () => Promise.resolve(true),
      countForDraft: () => Promise.resolve(0),
      history: unused,
      fanStats: unused,
    },
    cardReads: { pace: unused, toRead: unused, markRead: unused },
    drafts: {
      lock: () => Promise.resolve(draft),
      openFor: unused,
      existsWithKey: unused,
      paceSince: unused,
      insert: unused,
      setStatus: (_id, status, decision) => {
        changes.push({ status, decision });
        return Promise.resolve();
      },
      place: unused,
      rateLive: unused,
    },
    events: {
      append: (_conversation, body) => {
        if (body.type === 'send_failed') {
          failures.push({ error: body.payload.error ?? '', isFinal: body.payload.isFinal });
        }
        return Promise.resolve(1);
      },
      publish: () => Promise.resolve(),
      list: unused,
      alertsSince: unused,
      scriptsExhaustedSaid: unused,
      abandonTeases: unused,
      salesState: unused,
    },
    jobs: { enqueue: () => Promise.resolve() },
    gate: { blockedReason: () => Promise.resolve(null), fanFlags: unused },
    switches: { lockCreator: unused, archived: unused, isOn: unused, setCreator: unused },
    automatic: { personaActive: unused, decided: unused, latestBlindTest: unused, recordBlindTest: unused },
    audit: { record: unused },
    scriptRuns: { latest: unused, open: unused, save: unused, stalled: unused },
  };
  const uow: UnitOfWork = { inTenant: (_creatorId, work) => work(tx) };
  const sender: OutboundSender = {
    sendText: send,
    sendMedia: unused,
    sendStep: unused,
    verifySent: () => Promise.resolve({ status: 'not_found' }),
  };
  const job = createSendJob({ uow, clock: { now: () => now }, sender });
  const logger = { info: () => undefined, warn: () => undefined };
  const payload = {
    creatorId: conversation.creatorId,
    conversationId: conversation.id,
    draftId: draft.id,
    correlationId: 'corr-1',
  };
  return { changes, failures, run: (attempt: number) => job(payload, logger, attempt) };
}

describe('conversation.send', () => {
  it('keeps who approved the draft, and when, once it is sent (recette REV-06)', async () => {
    const { changes, run } = world(() =>
      Promise.resolve({ messageRef: { platform: 'reveal', id: 'msg_1' }, sentAt: now.toISOString() }),
    );
    await run(1);
    expect(changes).toEqual([{ status: 'sent', decision: undefined }]);
  });

  it('keeps who approved the draft, and when, once it failed for good (recette REV-06)', async () => {
    const { changes, run } = world(() => Promise.reject(new SendRefused('connector_writes_disabled', 'non')));
    await run(1);
    expect(changes).toEqual([{ status: 'failed', decision: undefined }]);
  });

  it('a platform that does not answer fails the draft only after the last attempt (recette REV-01)', async () => {
    const outage = (): Promise<never> =>
      Promise.reject(new DomainError('connector_transient', 'La plateforme a refusé l’opération'));
    const { changes, failures, run } = world(outage);
    for (let attempt = 1; attempt < MAX_SEND_ATTEMPTS; attempt += 1) {
      await expect(run(attempt)).rejects.toThrow();
    }
    expect(changes).toEqual([]);
    await run(MAX_SEND_ATTEMPTS);
    expect(changes).toEqual([{ status: 'failed', decision: undefined }]);
    expect(failures.at(-1)).toEqual({ error: 'connector_transient', isFinal: true });
    expect(failures.filter((failure) => failure.isFinal === true)).toHaveLength(1);
  });
});
