import {
  ConnectorConfigSchema,
  CreatorIdSchema,
  PlatformAccountIdSchema,
  type ConnectionSignal,
  type ConversationSnapshot,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../../domain/platform-connector';
import type { AccountStore, ConnectorAccount } from '../../domain/ports';
import { FakeConnector } from '../../infra/fake/FakeConnector';
import { createPollJob } from '../poll';
import { tellingSessionDeaths } from '../read-health';

/** An invented account of a demo creator. */
const hers = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000d1');
const accountId = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000d2');
const now = new Date('2026-11-28T00:30:00Z');

/** A platform whose answers no longer have the shape the connector knows, as the Reveal client says it. */
class ChangedConnector extends FakeConnector {
  override listConversations(): Promise<ConversationSnapshot[]> {
    return Promise.reject(new ConnectorError('fatal', 'shape_changed: conversations (items.0.id)'));
  }
}

const unused = (): Promise<never> => Promise.reject(new Error('not used by this job'));

function setup(
  over: Partial<ConnectorAccount> = {},
  connector: FakeConnector = new FakeConnector({ now: () => now }),
) {
  let held: ConnectorAccount = {
    id: accountId,
    creatorId: hers,
    platform: 'reveal',
    sessionState: 'valid',
    lastPollAt: new Date(now.getTime() - 60_000),
    profileBioReadAt: null,
    consecutiveErrors: 0,
    pausedUntil: null,
    config: ConnectorConfigSchema.parse({}),
    ...over,
  };
  const told: ConnectionSignal[] = [];
  const accounts: AccountStore = {
    listPollable: unused,
    creatorOf: unused,
    listSyncable: unused,
    get: () => Promise.resolve(held),
    sessionOf: unused,
    recordPoll: (_c, _i, at) => {
      held = { ...held, lastPollAt: at, consecutiveErrors: 0, pausedUntil: null };
      return Promise.resolve();
    },
    recordProfileBio: () => Promise.resolve(),
    profileBioOf: unused,
    recordFailure: (_c, _i, state) => {
      held = { ...held, ...state };
      return Promise.resolve();
    },
    setSessionState: (_c, _i, to) => {
      held = { ...held, sessionState: to };
      return Promise.resolve();
    },
    storeSession: unused,
    recordRefusedSession: unused,
    publish: () => Promise.resolve(),
  };
  const readHealth = (_platform: string, signal: ConnectionSignal) => {
    told.push(signal);
    return Promise.resolve();
  };
  const job = createPollJob({
    accounts: tellingSessionDeaths(accounts, readHealth),
    resolver: { platforms: ['reveal'], forAccount: () => Promise.resolve(connector) },
    ingest: () => Promise.resolve({ isNew: true }),
    clock: { now: () => now },
    readHealth,
  });
  const run = () =>
    job(
      { creatorId: hers, platformAccountId: accountId, correlationId: 'read' },
      { info: () => undefined, warn: () => undefined },
    );
  return { told, run, connector };
}

describe('the owners are told when the AI no longer reads Reveal (décision du 27/11/2026)', () => {
  it('says nothing at one failed read, and tells it down with its cause when the breaker opens', async () => {
    const { told, run } = setup({}, new ChangedConnector({ now: () => now }));
    for (let read = 1; read < 5; read += 1) await run();
    expect(told).toEqual([]);
    await run();
    expect(told).toEqual([{ state: 'down', reason: 'format_changed' }]);
  });

  it('tells a platform that no longer answers as unreachable', async () => {
    const connector = new FakeConnector({ now: () => now });
    const { told, run } = setup({ consecutiveErrors: 4 }, connector);
    connector.failNext('listConversations', 'transient');
    await run();
    expect(told).toEqual([{ state: 'down', reason: 'unreachable' }]);
  });

  it('tells a session that died at once, whatever marked it', async () => {
    const connector = new FakeConnector({ now: () => now });
    connector.expireSession();
    const { told, run } = setup({}, connector);
    await run();
    expect(told).toEqual([{ state: 'down', reason: 'session_expired' }]);
  });

  it('tells it back at the first read after a pause or a gap, never in the regular rhythm', async () => {
    const regular = setup();
    await regular.run();
    expect(regular.told).toEqual([]);
    const afterBreaker = setup({ pausedUntil: new Date(now.getTime() - 1_000) });
    await afterBreaker.run();
    expect(afterBreaker.told).toEqual([{ state: 'back' }]);
    const afterSync = setup({ lastPollAt: new Date(now.getTime() - 3 * 3_600_000) });
    await afterSync.run();
    expect(afterSync.told).toEqual([{ state: 'back' }]);
  });
});
