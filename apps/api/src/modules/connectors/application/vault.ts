import {
  PlatformScriptSchema,
  VaultMediaSchema,
  VaultViewSchema,
  type CreatorId,
  type JobPayload,
  type PlatformAccountId,
  type PlatformScript,
  type VaultFolderView,
  type VaultView,
} from '@impera/contracts';
import { z } from 'zod';

import { PlatformAccountNotFound, PlatformReadUnavailable, VaultForbidden } from '../domain/errors';
import { ConnectorError, type PlatformConnector } from '../domain/platform-connector';
import type { AccountStore, Clock, ConnectorAccount, JobLogger } from '../domain/ports';
import {
  compareVaultFolders,
  compareVaultOrder,
  type VaultRefRow,
  type VaultStore,
} from '../domain/vault-sync';

import { recordConnectorFailure } from './failures';
import { loadActiveAccount } from './poll';
import type { ConnectorResolver } from './resolver';

export interface VaultDeps {
  readonly accounts: AccountStore;
  readonly resolver: ConnectorResolver;
  readonly store: VaultStore;
  readonly clock: Clock;
}

/**
 * `connector.vault_sync` (ADR 0099 § 2 to 4, fiche vault-sync), on the account's queue: the whole vault read once, its
 * folders and media mirrored in `media_platform_refs`. Read only: never a file, a link kept, nor a model call. A
 * connector that does not declare `vault` is never asked. Connector errors feed the breaker, as a poll's do.
 */
export function createVaultSyncJob(deps: VaultDeps) {
  return async (payload: JobPayload<'connector.vault_sync'>, logger: JobLogger): Promise<void> => {
    const now = deps.clock.now();
    const account = await loadActiveAccount(deps, payload, now);
    if (typeof account === 'string') {
      logger.info({ platformAccountId: payload.platformAccountId, reason: account }, 'vault sync: skipped');
      return;
    }
    const connector = await deps.resolver.forAccount(account);
    if (connector?.capabilities.vault !== true || connector.listVaultMedia === undefined) {
      logger.info({ platformAccountId: account.id, reason: 'no vault read' }, 'vault sync: skipped');
      return;
    }
    const meta = { correlationId: payload.correlationId, at: now };
    try {
      const read = z.array(VaultMediaSchema).parse(await connector.listVaultMedia({}));
      const outcome = await deps.store.apply(account, read, now);
      if (outcome === null) {
        logger.info({ platformAccountId: account.id, reason: 'archived' }, 'vault sync: skipped');
        return;
      }
      logger.info({ platformAccountId: account.id, ...outcome }, 'vault sync: done');
    } catch (error) {
      await recordConnectorFailure(deps.accounts, account, error, { meta, logger, jobName: 'vault_sync' });
    }
  };
}

function mediaOf(row: VaultRefRow): VaultFolderView['media'][number] {
  return {
    platformMediaId: row.platformMediaId,
    kind: row.kind,
    durationSeconds: row.durationSeconds,
    uploadedAt: row.platformCreatedAt,
    platformDescription: row.platformDescription,
    suggestedPriceMinor:
      row.suggestedMinMinor === null || row.suggestedMaxMinor === null
        ? null
        : { min: row.suggestedMinMinor, max: row.suggestedMaxMinor },
    removed: row.removedAt !== null,
  };
}

/** Her vault folder by folder, each in the platform's order; the folders by their number, the root last. */
function vaultViewOf(creatorId: CreatorId, rows: readonly VaultRefRow[]): VaultView {
  const folders = new Map<string, { readonly head: VaultRefRow; readonly rows: VaultRefRow[] }>();
  for (const row of rows) {
    const key = `${row.platformAccountId}|${row.folderRef ?? ''}`;
    const folder = folders.get(key);
    if (folder === undefined) folders.set(key, { head: row, rows: [row] });
    else folder.rows.push(row);
  }
  const synced = rows.map((row) => row.lastSyncedAt.getTime());
  return VaultViewSchema.parse({
    creatorId,
    folders: [...folders.values()]
      .sort((a, b) => compareVaultFolders(a.head, b.head))
      .map(({ head, rows: inside }) => ({
        platform: head.platform,
        platformAccountId: head.platformAccountId,
        folderRef: head.folderRef,
        folderName: head.folderName,
        moment: head.folderMoment,
        media: [...inside].sort(compareVaultOrder).map(mediaOf),
      })),
    syncedAt: synced.length === 0 ? null : new Date(Math.max(...synced)).toISOString(),
  });
}

export interface VaultReads {
  /** Her vault as the last sync read it, for the owner and an active manager of her list (`vault_forbidden`). */
  view(creatorId: CreatorId, userId: string): Promise<VaultView>;
}

export function createVaultReads(store: VaultStore): VaultReads {
  return {
    async view(creatorId, userId) {
      const rows = await store.rows(creatorId, userId);
      if (rows === null) throw new VaultForbidden();
      return vaultViewOf(creatorId, rows);
    },
  };
}

/**
 * Reads of the platform for another module's adapter (fiche vault-sync, asked for the import of the scripts by
 * `scripts`): through the resolver, as the jobs do, each behind its `capabilities` flag. Never a write.
 */
export interface PlatformReads {
  /** The account's scripts as the platform lists them (`listPlatformScripts`); `platform_read_unavailable` otherwise. */
  scripts(platformAccountId: PlatformAccountId): Promise<PlatformScript[]>;
}

export function createPlatformReads(deps: Omit<VaultDeps, 'store'>): PlatformReads {
  async function connectorOf(platformAccountId: PlatformAccountId): Promise<{
    readonly account: ConnectorAccount;
    readonly connector: PlatformConnector;
  }> {
    const owner = await deps.accounts.creatorOf(platformAccountId);
    if (owner === null) throw new PlatformAccountNotFound();
    const account = await loadActiveAccount(
      deps,
      { creatorId: owner.creatorId, platformAccountId, correlationId: 'platform-read' },
      deps.clock.now(),
    );
    if (account === 'unknown account') throw new PlatformAccountNotFound();
    if (typeof account === 'string') throw new PlatformReadUnavailable('session');
    const connector = await deps.resolver.forAccount(account);
    if (connector === null) throw new PlatformReadUnavailable('unsupported');
    return { account, connector };
  }

  return {
    async scripts(platformAccountId) {
      const { connector } = await connectorOf(platformAccountId);
      if (!connector.capabilities.scripts || connector.listPlatformScripts === undefined) {
        throw new PlatformReadUnavailable('unsupported');
      }
      try {
        return z.array(PlatformScriptSchema).parse(await connector.listPlatformScripts());
      } catch (error) {
        if (error instanceof ConnectorError) {
          throw new PlatformReadUnavailable(error.code === 'session_expired' ? 'session' : 'failed');
        }
        throw error;
      }
    },
  };
}
