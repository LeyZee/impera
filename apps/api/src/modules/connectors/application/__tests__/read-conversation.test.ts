import { ConnectorConfigSchema, CreatorIdSchema, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { AccountStore, ConnectorAccount, IngestMessage } from '../../domain/ports';
import { FakeConnector } from '../../infra/fake/FakeConnector';
import {
  createAskConversationRead,
  createReadConversationJob,
  READ_AGAIN_AFTER_MS,
} from '../read-conversation';

const hers = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000b1');
const other = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000b2');

const account = (id: string, creatorId = hers): ConnectorAccount => ({
  id: PlatformAccountIdSchema.parse(id),
  creatorId,
  platform: 'reveal',
  sessionState: 'valid',
  lastPollAt: null,
  consecutiveErrors: 0,
  pausedUntil: null,
  config: ConnectorConfigSchema.parse({}),
});

const unused = (): Promise<never> => Promise.reject(new Error('not used by this job'));

/** The account store the job reads: `get` only; the breaker is never written. */
function storeOf(held: ConnectorAccount): AccountStore & { failures: number } {
  const store = {
    failures: 0,
    listPollable: unused,
    creatorOf: unused,
    listSyncable: unused,
    get: () => Promise.resolve(held),
    sessionOf: unused,
    recordPoll: unused,
    recordProfileBio: unused,
    profileBioOf: unused,
    recordFailure: () => {
      store.failures += 1;
      return Promise.resolve();
    },
    setSessionState: unused,
    storeSession: unused,
    recordRefusedSession: unused,
    publish: unused,
  };
  return store;
}

const logger = { info: () => undefined, warn: () => undefined };

/** Recette du 16/11: the copilot opened a conversation calm since before the account's first poll. */
describe('read one conversation by its id', () => {
  it('ingests its last messages, a fresh one answered like a polled one', async () => {
    const now = new Date('2026-11-16T12:00:00Z');
    const connector = new FakeConnector({ now: () => now });
    connector.enqueueInbound({ conversationId: 'c1', fanId: 'f1', fanDisplayName: 'Fan', text: 'coucou' });
    const held = account('0199f2a0-0000-7000-8000-0000000000a1');
    const seen: Parameters<IngestMessage>[0][] = [];
    const job = createReadConversationJob({
      accounts: storeOf(held),
      resolver: { platforms: ['reveal'], forAccount: () => Promise.resolve(connector) },
      ingest: (input) => {
        seen.push(input);
        return Promise.resolve({ isNew: true });
      },
      clock: { now: () => now },
    });

    await job(
      { creatorId: hers, platformAccountId: held.id, platformConversationId: 'c1', correlationId: 'r1' },
      logger,
    );

    expect(connector.calls.getConversation).toBe(1);
    expect(connector.calls.listConversations).toBe(0);
    expect(seen.map((input) => input.message.text)).toEqual(['coucou']);
    expect(seen[0]?.catchUp).toBe(false);
  });

  it('stops quietly on a conversation this account does not hold, and never feeds the breaker', async () => {
    const connector = new FakeConnector();
    const held = account('0199f2a0-0000-7000-8000-0000000000a1');
    const store = storeOf(held);
    const job = createReadConversationJob({
      accounts: store,
      resolver: { platforms: ['reveal'], forAccount: () => Promise.resolve(connector) },
      ingest: () => Promise.reject(new Error('nothing to ingest')),
      clock: { now: () => new Date() },
    });

    await job(
      {
        creatorId: hers,
        platformAccountId: held.id,
        platformConversationId: 'elsewhere',
        correlationId: 'r1',
      },
      logger,
    );
    connector.failNext('getConversation', 'transient');
    await job(
      {
        creatorId: hers,
        platformAccountId: held.id,
        platformConversationId: 'elsewhere',
        correlationId: 'r2',
      },
      logger,
    );

    expect(connector.calls.getConversation).toBe(2);
    expect(store.failures).toBe(0);
  });
});

describe('ask the read of an unknown conversation', () => {
  it('queues it on her accounts of that platform, once a minute at most', async () => {
    let now = new Date('2026-11-16T12:00:00Z');
    const queued: string[] = [];
    const ask = createAskConversationRead({
      accounts: {
        listPollable: () =>
          Promise.resolve([
            account('0199f2a0-0000-7000-8000-0000000000a1'),
            account('0199f2a0-0000-7000-8000-0000000000a2', other),
          ]),
      },
      jobs: {
        enqueueConversationRead: (held, platformConversationId) => {
          queued.push(`${held.id} ${platformConversationId}`);
          return Promise.resolve();
        },
      },
      platforms: ['reveal'],
      clock: { now: () => now },
    });
    const conversation = { creatorIds: [hers], platform: 'reveal' as const, platformConversationId: 'c1' };

    expect(await ask({ ...conversation, correlationId: 'r1' })).toBe(1);
    expect(await ask({ ...conversation, correlationId: 'r2' })).toBe(0);
    expect(await ask({ ...conversation, platformConversationId: 'c2', correlationId: 'r3' })).toBe(1);
    now = new Date(now.getTime() + READ_AGAIN_AFTER_MS);
    expect(await ask({ ...conversation, correlationId: 'r4' })).toBe(1);

    expect(queued).toEqual([
      '0199f2a0-0000-7000-8000-0000000000a1 c1',
      '0199f2a0-0000-7000-8000-0000000000a1 c2',
      '0199f2a0-0000-7000-8000-0000000000a1 c1',
    ]);
  });

  it('asks nothing of a platform without an adapter', async () => {
    const ask = createAskConversationRead({
      accounts: { listPollable: () => Promise.reject(new Error('not read')) },
      jobs: { enqueueConversationRead: () => Promise.reject(new Error('not queued')) },
      platforms: [],
      clock: { now: () => new Date() },
    });
    expect(
      await ask({
        creatorIds: [hers],
        platform: 'reveal',
        platformConversationId: 'c1',
        correlationId: 'r1',
      }),
    ).toBe(0);
  });
});
