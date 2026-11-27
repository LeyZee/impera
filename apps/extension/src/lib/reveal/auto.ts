import type { ConnectorAccountChoice, PlatformAccountId } from '@impera/contracts';

import type { Sent } from '../watch/api';

import type { Synced } from './api';
import type { Captured, RevealSession } from './capture';

/**
 * The sync « à l'ouverture » (ADR 0147): when the owner opens the popup on a Reveal tab, the service worker reads the
 * session the tab already sends and gives it to the one account whose model the tab names, if that account was synced
 * by hand once and the CRM says its session is over or ends soon. Nothing else starts it. The session lives in this
 * function alone: never stored, never logged, never sent back to the popup.
 */

/** The accounts whose session the CRM says is over or ends soon (`warning`): the only ones worth a reading. */
const DUE: readonly ConnectorAccountChoice['sessionState'][] = ['expired', 'warning'];

export interface AutoDeps {
  readonly readLink: () => Promise<string | null>;
  readonly origin: () => Promise<string>;
  readonly accounts: (
    origin: string,
    token: string,
  ) => Promise<Sent<{ readonly accounts: readonly ConnectorAccountChoice[] }>>;
  /** Reads the active tab, without reloading it, with the model expected when only one account is due. */
  readonly capture: (expected: string | null) => Promise<Captured | null>;
  readonly send: (
    origin: string,
    token: string,
    accountId: PlatformAccountId,
    session: RevealSession,
    trigger: 'open',
  ) => Promise<Synced>;
  readonly markRevoked: () => Promise<void>;
  readonly remember: (accountId: PlatformAccountId, modelId: string) => Promise<void>;
}

/** What the sync at the opening left: stored for that account, or nothing, quietly (§ 4: no red, the button stays). */
export type AutoSynced =
  | {
      readonly state: 'synced';
      readonly accountId: PlatformAccountId;
      readonly expiresAt: string | null;
      readonly reconnectFirst: boolean;
      readonly kept: boolean;
    }
  | { readonly state: 'idle' };

const IDLE: AutoSynced = { state: 'idle' };

export async function syncAtOpening(deps: AutoDeps): Promise<AutoSynced> {
  const token = await deps.readLink();
  if (token === null) return IDLE;
  const origin = await deps.origin();
  // Only the owner's link lists accounts (ADR 0066 § 7): any other answer stops here.
  const listed = await deps.accounts(origin, token);
  if (listed.kind !== 'ok') {
    if (listed.kind === 'revoked') await deps.markRevoked();
    return IDLE;
  }
  // Synced by hand once (its model is known), and over or ending soon: else there is nothing to read the tab for.
  const due = listed.value.accounts.filter(
    (account) => DUE.includes(account.sessionState) && typeof account.modelId === 'string',
  );
  const [only, ...others] = due;
  if (only === undefined) return IDLE;
  const captured = await deps.capture(others.length === 0 ? (only.modelId ?? null) : null);
  if (captured?.state !== 'session') return IDLE;
  const { session } = captured;
  // The one account whose model the tab names, among all of them: none or several, nothing is sent.
  const named = listed.value.accounts.filter((account) => account.modelId === session.modelId);
  const [account, ...alike] = named;
  if (account === undefined || alike.length > 0 || !due.includes(account)) return IDLE;
  const synced = await deps.send(origin, token, account.id, session, 'open');
  if (synced.state === 'revoked') await deps.markRevoked();
  if (synced.state !== 'synced') return IDLE;
  await deps.remember(account.id, session.modelId);
  return { state: 'synced', accountId: account.id, ...synced.stored };
}
