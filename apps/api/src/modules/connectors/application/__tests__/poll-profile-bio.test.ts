import {
  ConnectorConfigSchema,
  CreatorIdSchema,
  PlatformAccountIdSchema,
  type CreatorProfile,
} from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { ConnectorError } from '../../domain/platform-connector';
import type { AccountStore, ConnectorAccount } from '../../domain/ports';
import { FakeConnector } from '../../infra/fake/FakeConnector';
import { createPollJob, PROFILE_BIO_EVERY_MINUTES } from '../poll';

const hers = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');
const accountId = PlatformAccountIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c2');
const now = new Date('2026-11-20T12:00:00Z');

/** A platform that shows her profile (ADR 0154): its bio, or a failure, as the test sets it. */
class ProfileConnector extends FakeConnector {
  override readonly capabilities = { ...new FakeConnector().capabilities, creatorProfile: true };
  bio: string | ConnectorError = 'Bio fictive';
  reads = 0;

  getCreatorProfile(): Promise<CreatorProfile> {
    this.reads += 1;
    return this.bio instanceof ConnectorError ? Promise.reject(this.bio) : Promise.resolve({ bio: this.bio });
  }
}

const unused = (): Promise<never> => Promise.reject(new Error('not used by this job'));

function setup(profileBioReadAt: Date | null) {
  const held: ConnectorAccount = {
    id: accountId,
    creatorId: hers,
    platform: 'reveal',
    sessionState: 'valid',
    lastPollAt: null,
    profileBioReadAt,
    consecutiveErrors: 0,
    pausedUntil: null,
    config: ConnectorConfigSchema.parse({}),
  };
  const recorded: string[] = [];
  const failures: unknown[] = [];
  const accounts: AccountStore = {
    listPollable: unused,
    creatorOf: unused,
    listSyncable: unused,
    get: () => Promise.resolve(held),
    sessionOf: unused,
    recordPoll: () => Promise.resolve(),
    recordProfileBio: (_creatorId, _id, bio) => {
      recorded.push(bio);
      return Promise.resolve();
    },
    profileBioOf: unused,
    recordFailure: (_c, _i, state) => {
      failures.push(state);
      return Promise.resolve();
    },
    setSessionState: () => Promise.resolve(),
    storeSession: unused,
    recordRefusedSession: unused,
    publish: unused,
  };
  const connector = new ProfileConnector({ now: () => now });
  const job = createPollJob({
    accounts,
    resolver: { platforms: ['reveal'], forAccount: () => Promise.resolve(connector) },
    ingest: () => Promise.resolve({ isNew: true }),
    clock: { now: () => now },
  });
  const run = () =>
    job(
      { creatorId: hers, platformAccountId: accountId, correlationId: 'bio' },
      { info: () => undefined, warn: () => undefined },
    );
  return { connector, recorded, failures, run };
}

describe('her profile bio read at the poll (ADR 0154)', () => {
  it('reads it when never read, and keeps it as read', async () => {
    const { connector, recorded, run } = setup(null);
    connector.bio = '  Bio fictive 🌶️  ';
    await run();
    expect(recorded).toEqual(['Bio fictive 🌶️']);
  });

  it('does not read it again before its pace, and does once it has passed', async () => {
    const fresh = setup(new Date(now.getTime() - (PROFILE_BIO_EVERY_MINUTES - 1) * 60_000));
    await fresh.run();
    expect(fresh.connector.reads).toBe(0);
    const stale = setup(new Date(now.getTime() - (PROFILE_BIO_EVERY_MINUTES + 1) * 60_000));
    await stale.run();
    expect(stale.recorded).toEqual(['Bio fictive']);
  });

  it('keeps the last bio on a failed read and still polls', async () => {
    const { connector, recorded, failures, run } = setup(null);
    connector.bio = new ConnectorError('transient', 'down');
    await run();
    expect(recorded).toEqual([]);
    expect(failures).toEqual([]);
    expect(connector.calls.listConversations).toBe(1);
  });

  it('stops the poll on an expired session, as anywhere else', async () => {
    const { connector, recorded, run } = setup(null);
    connector.bio = new ConnectorError('session_expired', 'gone');
    await run();
    expect(recorded).toEqual([]);
    expect(connector.calls.listConversations).toBe(0);
  });
});
