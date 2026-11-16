import { CreatorIdSchema, newId, PlatformAccountIdSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { SessionOwnerConflict } from '../../domain/errors';
import type { AccountStore } from '../../domain/ports';
import { createConnectorSessions } from '../sessions';

const creatorId = newId(CreatorIdSchema);
const platformAccountId = newId(PlatformAccountIdSchema);
const elsewhere = newId(PlatformAccountIdSchema);

const unexpected = (): Promise<never> => Promise.reject(new Error('a refusal never reaches this'));

/** The account, no stored session, and a line that cannot be written. */
const accounts: Pick<
  AccountStore,
  'creatorOf' | 'sessionOf' | 'storeSession' | 'setSessionState' | 'recordRefusedSession'
> = {
  creatorOf: () => Promise.resolve({ creatorId, platform: 'reveal' }),
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
        logger: { info: () => undefined, warn: (object, message) => warned.push({ object, message }) },
      }),
    ).rejects.toBeInstanceOf(SessionOwnerConflict);
    expect(warned).toHaveLength(1);
    expect(warned[0]?.object).toMatchObject({ platformAccountId, reason: 'owner_conflict' });
    expect(JSON.stringify(warned)).not.toContain('session-test-value');
  });
});
