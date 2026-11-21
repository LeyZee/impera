import type { CreatorId, Platform, PlatformAccountId } from '@impera/contracts';

import {
  PlatformAccountNotFound,
  SessionAutoSyncUnprocessable,
  SessionMemberConflict,
  SessionOwnerConflict,
  SessionMemberMismatch,
  SessionShapeUnprocessable,
  SessionTokenExpired,
  SessionVaultMissing,
} from '../domain/errors';
import type { AccountStore, Clock, JobLogger, SessionShapes, SessionVault } from '../domain/ports';
import { sessionLife, type SessionLife } from '../domain/session-life';

/** What a « Sync » left in place: the session sent, or the one kept because it lives longer (ADR 0147 § 7). */
type SessionStored = SessionLife & { readonly kept: boolean };

export interface ConnectorSessions {
  /**
   * Stores the session the extension captured, encrypted; the account becomes `valid` and its breaker closes. Refused
   * when it is not a session of the account's platform, when it belongs to another creator than the one stored or the
   * model the sales register links to the account, when another account already holds or is linked to her, or to
   * another team member than the one stored (the « bot » member, pinned at the first « Sync »). Answers what its
   * expiry says: `warning` under 2 h left, and `reconnectFirst` when it is not a fresh login's token. A sync « à
   * l'ouverture » (ADR 0147) is refused on an account with no session whose member is pinned; and a session that still
   * holds is kept over one that expires sooner, whatever the gesture.
   */
  store(input: {
    platformAccountId: PlatformAccountId;
    session: string;
    correlationId: string;
    /** Who synced it (the owner's link), for the audit. */
    userId: string | null;
    /** The owner's gesture (ADR 0147): a click on « Synchroniser » (the default), or the extension alone at the popup. */
    trigger?: 'click' | 'open';
    /** The request's logger: told when the line of a refusal could not be written. */
    logger?: JobLogger;
  }): Promise<SessionStored>;
  /** The decrypted session, or `null` when none was captured. Never logged, never sent to a client. */
  load(creatorId: CreatorId, platformAccountId: PlatformAccountId): Promise<string | null>;
  markExpired(
    creatorId: CreatorId,
    platformAccountId: PlatformAccountId,
    correlationId: string,
  ): Promise<void>;
}

/** Platform sessions at rest (security.md, ADR 0008): AES-256-GCM bound to the account id. */
export function createConnectorSessions(deps: {
  readonly accounts: Pick<
    AccountStore,
    'creatorOf' | 'get' | 'sessionOf' | 'storeSession' | 'setSessionState' | 'recordRefusedSession'
  >;
  readonly vault: SessionVault | null;
  readonly clock: Clock;
  /** How each platform's session reads; a platform without a reader takes no session. */
  readonly shapes: SessionShapes;
  /**
   * The account each platform model is linked to by the sales register (Réglages › Relevé des ventes): a session of
   * another model than this account's is refused even at the first « Sync », before any session is stored to compare
   * it with, and so is a session of a model the register links to another account.
   */
  readonly modelLinks: (platform: Platform) => Promise<ReadonlyMap<string, PlatformAccountId>>;
}): ConnectorSessions {
  const vault = (): SessionVault => {
    if (deps.vault === null) throw new SessionVaultMissing();
    return deps.vault;
  };
  const accept = async (
    account: { creatorId: CreatorId; platform: Platform },
    {
      platformAccountId,
      session,
      correlationId,
      userId,
      trigger,
    }: {
      platformAccountId: PlatformAccountId;
      session: string;
      correlationId: string;
      userId: string | null;
      trigger: 'click' | 'open';
    },
  ): Promise<SessionStored> => {
    const { creatorId } = account;
    const shape = deps.shapes[account.platform];
    const read = shape === undefined ? null : shape(session);
    if (read === 'member_mismatch') throw new SessionMemberMismatch();
    if (shape === undefined || read === null) throw new SessionShapeUnprocessable();
    // A token already past its expiry is no session: nothing stored, the breaker left as it is.
    const now = deps.clock.now();
    if ((read.expiresAt ?? null) !== null && (read.expiresAt?.getTime() ?? 0) <= now.getTime())
      throw new SessionTokenExpired();
    // The extension alone sends only a session whose member the token itself names (ADR 0147 § 4).
    if (trigger === 'open' && read.memberInToken !== true)
      throw new SessionAutoSyncUnprocessable('auto_member_unread');
    // A session of another creator would make this account speak for her: refused, whatever the state.
    const previous = await deps.accounts.sessionOf(creatorId, platformAccountId);
    const before = previous === null ? null : openOrNull(vault(), platformAccountId, previous);
    const storedRead = before === null ? null : shape(before);
    const stored = storedRead === 'member_mismatch' ? null : storedRead;
    // The extension alone never sets who the AI's account is (ADR 0147 § 1, § 4): a click did, once, before.
    if (trigger === 'open' && stored?.member === undefined) throw new SessionAutoSyncUnprocessable();
    if (stored !== null && stored.owner !== read.owner) throw new SessionOwnerConflict();
    // The first « Sync » has nothing stored to compare with: the model the register links to this account answers.
    const links = await deps.modelLinks(account.platform);
    const linked = [...links].filter(([, to]) => to === platformAccountId).map(([model]) => model);
    if (linked.length > 0 && !linked.includes(read.owner)) throw new SessionOwnerConflict();
    // Nor a session the register gives to another account: one mistaken « Sync » would read her under this creator.
    const elsewhere = links.get(read.owner);
    if (elsewhere !== undefined && elsewhere !== platformAccountId) throw new SessionOwnerConflict();
    // The member is pinned at the first « Sync » (P2-02): the owner's or a chatter's session is never the bot's.
    if (stored?.member !== undefined && stored.member !== read.member) throw new SessionMemberConflict();
    const at = now;
    // A session that still holds is not replaced by one that expires sooner (ADR 0147 § 7): yesterday's token copied
    // again from a browser never shortens today's.
    const storedExpiry = stored?.expiresAt ?? null;
    const sentExpiry = read.expiresAt ?? null;
    if (
      storedExpiry !== null &&
      sentExpiry !== null &&
      sentExpiry.getTime() < storedExpiry.getTime() &&
      storedExpiry.getTime() > at.getTime() &&
      (await deps.accounts.get(creatorId, platformAccountId))?.sessionState !== 'expired'
    )
      return { ...sessionLife(storedExpiry, at), kept: true };
    const sealed = vault().seal(platformAccountId, session);
    // Reveal's token lives 24 h from the login, not from the « Sync » (spec § 2): one copied from a browser logged in
    // yesterday is stored as it is, but never called valid when it has under 2 h left.
    const life = sessionLife(read.expiresAt ?? null, at);
    await deps.accounts.storeSession(
      creatorId,
      platformAccountId,
      {
        ciphertext: sealed,
        // One platform identity, one account: the store refuses an owner another account already holds.
        owner: read.owner,
        // Compared in clear: GCM seals the same session differently each time. One that no longer opens (a retired
        // key) is not the same.
        isSame: (stored) => openOrNull(vault(), platformAccountId, stored) === session,
        state: life.state,
      },
      { correlationId, at, userId, trigger },
    );
    return { ...life, kept: false };
  };
  return {
    async store(input) {
      const account = await deps.accounts.creatorOf(input.platformAccountId);
      if (account === null) throw new PlatformAccountNotFound();
      try {
        return await accept(account, { ...input, trigger: input.trigger ?? 'click' });
      } catch (error) {
        // A refused « Sync » leaves its line: who, which account, why. Nothing of the session, nor of the platform.
        const reason =
          error instanceof SessionOwnerConflict
            ? 'owner_conflict'
            : error instanceof SessionMemberConflict
              ? 'member_conflict'
              : error instanceof SessionAutoSyncUnprocessable
                ? error.why
                : null;
        if (reason !== null) {
          // The refusal stays the answer whatever happens to its line: a line that cannot be written is logged.
          await deps.accounts
            .recordRefusedSession(account.creatorId, input.platformAccountId, reason, {
              correlationId: input.correlationId,
              at: deps.clock.now(),
              userId: input.userId,
              trigger: input.trigger ?? 'click',
            })
            .catch((err: unknown) => {
              input.logger?.warn(
                { platformAccountId: input.platformAccountId, reason, err },
                'connector session: refusal not audited',
              );
            });
        }
        throw error;
      }
    },
    async load(creatorId, platformAccountId) {
      const sealed = await deps.accounts.sessionOf(creatorId, platformAccountId);
      return sealed === null ? null : vault().open(platformAccountId, sealed);
    },
    markExpired: (creatorId, platformAccountId, correlationId) =>
      deps.accounts.setSessionState(creatorId, platformAccountId, 'expired', {
        correlationId,
        at: deps.clock.now(),
      }),
  };
}

function openOrNull(
  vault: SessionVault,
  platformAccountId: PlatformAccountId,
  sealed: Buffer,
): string | null {
  try {
    return vault.open(platformAccountId, sealed);
  } catch {
    return null;
  }
}
