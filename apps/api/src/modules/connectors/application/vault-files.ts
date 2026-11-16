import type { CreatorId, PlatformAccountId } from '@impera/contracts';

import { ConnectorError } from '../domain/platform-connector';
import type { AccountStore, Clock, JobLogger } from '../domain/ports';

import { recordConnectorFailure } from './failures';
import { loadActiveAccount } from './poll';
import type { ConnectorResolver } from './resolver';

/** One media of the vault to read, as `media_platform_refs` names it (ADR 0113). */
interface VaultFileAsk {
  readonly creatorId: CreatorId;
  readonly platformAccountId: PlatformAccountId;
  readonly platformMediaId: string;
  /** `null` at the vault's root. */
  readonly folderRef: string | null;
  /** A fixed name in a folder the caller made for this file alone, and removes, read or not. */
  readonly path: string;
  readonly correlationId: string;
}

/**
 * What became of a read (ADR 0113 § 2 to 4). `unavailable`: the account cannot be read now (no session, breaker open,
 * no connector or no `mediaDownload`), nothing else of it is asked in this run. `later`: this file failed for a while
 * (a link expired twice, a broken download, the platform asking to wait), taken again by a later run. `gone`: the media
 * is no longer in its folder. `unreadable`: the file is of a form we do not read or breaks a bound (a stream of an
 * unknown form, too large, a host not listed): it waits for the agency's text, never an invented description.
 */
type VaultFileOutcome =
  | { readonly status: 'fetched'; readonly bytes: number; readonly contentType: string | null }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'later' | 'gone' | 'unreadable' };

export interface VaultFiles {
  fetch(ask: VaultFileAsk, logger: JobLogger): Promise<VaultFileOutcome>;
}

/**
 * A vault file read for another module's job (`media.describe_vault`, ADR 0113), through the resolver as the jobs read,
 * behind the `mediaDownload` flag. Never a write to the platform. A session the platform refuses stops the account and
 * a rate limit feeds the breaker, as a poll's do; a file's own failure never counts against the account.
 */
export function createVaultFiles(deps: {
  readonly accounts: AccountStore;
  readonly resolver: ConnectorResolver;
  readonly clock: Clock;
}): VaultFiles {
  return {
    async fetch(ask, logger) {
      const now = deps.clock.now();
      const account = await loadActiveAccount(
        deps,
        {
          creatorId: ask.creatorId,
          platformAccountId: ask.platformAccountId,
          correlationId: ask.correlationId,
        },
        now,
      );
      if (typeof account === 'string') return { status: 'unavailable', reason: account };
      const connector = await deps.resolver.forAccount(account);
      if (connector?.capabilities.mediaDownload !== true || connector.fetchMedia === undefined) {
        return { status: 'unavailable', reason: 'no media download' };
      }
      try {
        const fetched = await connector.fetchMedia(
          { platform: account.platform, id: ask.platformMediaId },
          {
            folderRef: ask.folderRef === null ? null : { platform: account.platform, id: ask.folderRef },
            path: ask.path,
          },
        );
        return { status: 'fetched', bytes: fetched.bytes, contentType: fetched.contentType };
      } catch (error) {
        if (!(error instanceof ConnectorError)) throw error;
        switch (error.code) {
          case 'not_found':
            return { status: 'gone' };
          case 'fatal':
            return { status: 'unreadable' };
          case 'transient':
            return { status: 'later' };
          case 'session_expired':
          case 'rate_limited': {
            await recordConnectorFailure(deps.accounts, account, error, {
              meta: { correlationId: ask.correlationId, at: now },
              logger,
              jobName: 'vault_file',
            });
            return { status: 'unavailable', reason: error.code };
          }
        }
      }
    },
  };
}
