import { ConnectorConfigSchema, CreatorIdSchema, newId, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import {
  SessionAutoSyncUnprocessable,
  SessionMemberConflict,
  SessionOwnerConflict,
  SessionShapeUnprocessable,
} from '../../domain/errors';
import type { AccountStore } from '../../domain/ports';
import { createConnectorSessions } from '../sessions';

const creatorId = newId(CreatorIdSchema);
const platformAccountId = newId(PlatformAccountIdSchema);
const elsewhere = newId(PlatformAccountIdSchema);

const unexpected = (): Promise<never> => Promise.reject(new Error('a refusal never reaches this'));

/** The account, no stored session, and a line that cannot be written. */
const accounts: Pick<
  AccountStore,
  'creatorOf' | 'get' | 'sessionOf' | 'storeSession' | 'setSessionState' | 'recordRefusedSession'
> = {
  creatorOf: () => Promise.resolve({ creatorId, platform: 'reveal' }),
  get: unexpected,
  sessionOf: () => Promise.resolve(null),
  storeSession: unexpected,
  setSessionState: unexpected,
  recordRefusedSession: () => Promise.reject(new Error('the database is away')),
};

describe('a refused « Sync » whose audit line cannot be written (SEC-13)', () => {
  it('stays a refusal, and says so in the log without a value of the session', async () => {
    const warned: { object: object; message: string }[] = [];
    const sessions = createConnectorSessions({
      accounts,
      vault: null,
      clock: { now: () => new Date('2026-11-16T08:00:00Z') },
      shapes: { reveal: () => ({ owner: 'model-test-a', member: 'member-test-a' }) },
      modelLinks: () => Promise.resolve(new Map([['model-test-a', elsewhere]])),
    });
    await expect(
      sessions.store({
        platformAccountId,
        session: 'session-test-value',
        correlationId: 'correlation-test',
        userId: null,
        trigger: 'click',
        logger: { info: () => undefined, warn: (object, message) => warned.push({ object, message }) },
      }),
    ).rejects.toBeInstanceOf(SessionOwnerConflict);
    expect(warned).toHaveLength(1);
    expect(warned[0]?.object).toMatchObject({ platformAccountId, reason: 'owner_conflict' });
    expect(JSON.stringify(warned)).not.toContain('session-test-value');
  });
});

describe('a « Sync » of a token with an hour left (16/11)', () => {
  it('is stored as warning, and says to log in again first', async () => {
    const stored: { state: string }[] = [];
    const sessions = createConnectorSessions({
      accounts: {
        ...accounts,
        storeSession: (_creator, _id, session) => {
          stored.push({ state: session.state });
          return Promise.resolve();
        },
      },
      vault: { seal: () => Buffer.from('sealed'), open: () => 'never-read' },
      clock: { now: () => new Date('2026-11-16T22:00:00Z') },
      shapes: {
        reveal: () => ({
          owner: 'model-test-a',
          member: 'member-test-a',
          expiresAt: new Date('2026-11-16T22:56:00Z'),
        }),
      },
      modelLinks: () => Promise.resolve(new Map()),
    });
    const life = await sessions.store({
      platformAccountId,
      session: 'session-test-value',
      correlationId: 'correlation-test',
      userId: null,
      trigger: 'click',
    });
    expect(life).toEqual({
      state: 'warning',
      expiresAt: new Date('2026-11-16T22:56:00Z'),
      reconnectFirst: true,
      kept: false,
    });
    expect(stored).toEqual([{ state: 'warning' }]);
  });
});

/**
 * Invented sessions: `<member>|<model>|<expiry ISO or ->[|declared]`, read by a test shape (`declared`: the member is not
 * in the token, only beside it); the vault keeps them as they are.
 */
const testShape = (raw: string) => {
  const [member, owner, expiry, declared] = raw.split('|');
  if (member === undefined || owner === undefined || expiry === undefined) return null;
  return {
    owner,
    member,
    expiresAt: expiry === '-' ? null : new Date(expiry),
    memberInToken: declared === undefined,
  };
};
const plainVault = {
  seal: (_id: unknown, session: string) => Buffer.from(session),
  open: (_id: unknown, sealed: Buffer) => sealed.toString('utf8'),
};

function harness(storedSession: string | null, state: 'valid' | 'warning' | 'expired' = 'valid') {
  const stored: string[] = [];
  const refused: { reason: string; trigger: string }[] = [];
  const sessions = createConnectorSessions({
    accounts: {
      ...accounts,
      get: () =>
        Promise.resolve({
          id: platformAccountId,
          creatorId,
          platform: 'reveal',
          sessionState: state,
          lastPollAt: null,
          config: ConnectorConfigSchema.parse({}),
          consecutiveErrors: 0,
          pausedUntil: null,
        }),
      sessionOf: () => Promise.resolve(storedSession === null ? null : Buffer.from(storedSession)),
      storeSession: (_creator, _id, session) => {
        stored.push(session.ciphertext.toString('utf8'));
        return Promise.resolve();
      },
      recordRefusedSession: (_creator, _id, reason, meta) => {
        refused.push({ reason, trigger: meta.trigger });
        return Promise.resolve();
      },
    },
    vault: plainVault,
    clock: { now: () => new Date('2026-11-17T08:00:00Z') },
    shapes: { reveal: testShape },
    modelLinks: () => Promise.resolve(new Map()),
  });
  const send = (session: string, trigger: 'click' | 'open') =>
    sessions.store({ platformAccountId, session, correlationId: 'correlation-test', userId: null, trigger });
  return { send, stored, refused };
}

describe('a sync « à l’ouverture » (ADR 0147)', () => {
  it('is refused on an account never synced by hand, and the refusal says so', async () => {
    const { send, stored, refused } = harness(null);
    await expect(send('member-test-a|model-test-a|2026-11-18T07:00:00Z', 'open')).rejects.toBeInstanceOf(
      SessionAutoSyncUnprocessable,
    );
    expect(stored).toEqual([]);
    expect(refused).toEqual([{ reason: 'auto_unpinned', trigger: 'open' }]);
  });

  it('is refused for another member than the one pinned, like a click', async () => {
    const { send, stored } = harness('member-test-a|model-test-a|2026-11-17T07:00:00Z', 'expired');
    await expect(send('member-test-b|model-test-a|2026-11-18T07:00:00Z', 'open')).rejects.toBeInstanceOf(
      SessionMemberConflict,
    );
    expect(stored).toEqual([]);
  });

  it('is refused when the token itself does not name the member, a click is not (ADR 0147 § 4)', async () => {
    const pinned = 'member-test-a|model-test-a|2026-11-17T07:00:00Z';
    const { send, stored, refused } = harness(pinned, 'expired');
    await expect(
      send('member-test-a|model-test-a|2026-11-18T07:00:00Z|declared', 'open'),
    ).rejects.toBeInstanceOf(SessionAutoSyncUnprocessable);
    expect(refused).toEqual([{ reason: 'auto_member_unread', trigger: 'open' }]);
    expect(stored).toEqual([]);
    expect(await send('member-test-a|model-test-a|2026-11-18T07:00:00Z|declared', 'click')).toMatchObject({
      kept: false,
    });
  });

  it('renews an expired session of the pinned member', async () => {
    const { send, stored } = harness('member-test-a|model-test-a|2026-11-17T07:00:00Z', 'expired');
    expect(await send('member-test-a|model-test-a|2026-11-18T07:00:00Z', 'open')).toMatchObject({
      state: 'valid',
      kept: false,
    });
    expect(stored).toEqual(['member-test-a|model-test-a|2026-11-18T07:00:00Z']);
  });
});

describe('a session that still holds (ADR 0147 § 7)', () => {
  it('is kept over one that expires sooner, whatever the gesture', async () => {
    const { send, stored } = harness('member-test-a|model-test-a|2026-11-18T07:00:00Z');
    for (const trigger of ['click', 'open'] as const)
      expect(await send('member-test-a|model-test-a|2026-11-17T09:00:00Z', trigger)).toEqual({
        state: 'valid',
        expiresAt: new Date('2026-11-18T07:00:00Z'),
        reconnectFirst: false,
        kept: true,
      });
    expect(stored).toEqual([]);
  });

  it('is replaced by one that expires later, or when it no longer holds', async () => {
    expect(
      await harness('member-test-a|model-test-a|2026-11-17T09:00:00Z').send(
        'member-test-a|model-test-a|2026-11-18T07:00:00Z',
        'click',
      ),
    ).toMatchObject({ kept: false });
    // Expired by Reveal before its time: the poll said so, the one sent replaces it.
    expect(
      await harness('member-test-a|model-test-a|2026-11-18T07:00:00Z', 'expired').send(
        'member-test-a|model-test-a|2026-11-17T09:00:00Z',
        'click',
      ),
    ).toMatchObject({ kept: false });
  });

  it('refuses a token already past its expiry, whatever the gesture: nothing stored', async () => {
    const { send, stored } = harness('member-test-a|model-test-a|2026-11-17T07:00:00Z', 'expired');
    for (const trigger of ['click', 'open'] as const)
      await expect(send('member-test-a|model-test-a|2026-11-17T08:00:00Z', trigger)).rejects.toBeInstanceOf(
        SessionShapeUnprocessable,
      );
    expect(stored).toEqual([]);
  });
});
