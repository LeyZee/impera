import type { AccountStore } from '../domain/ports';
import type { ReadHealth } from '../domain/read-health';

/**
 * The account store, telling the read down whenever a session is marked `expired` (décision du 27/11/2026): by a poll,
 * by a send refused, or by a « Sync » the platform refused, the AI no longer reads that account. The state is written
 * first; a failure to tell it is logged by the caller's job, never undoes it.
 */
export function tellingSessionDeaths(
  accounts: AccountStore,
  readHealth: ReadHealth | undefined,
  onFailure: (error: unknown) => void = () => undefined,
): AccountStore {
  if (readHealth === undefined) return accounts;
  return {
    ...accounts,
    async setSessionState(creatorId, id, to, meta) {
      await accounts.setSessionState(creatorId, id, to, meta);
      if (to !== 'expired') return;
      try {
        const account = await accounts.get(creatorId, id);
        if (account === null) return;
        await readHealth(account.platform, { state: 'down', reason: 'session_expired' }, meta.correlationId);
      } catch (error) {
        onFailure(error);
      }
    },
  };
}
