import {
  FanPpvStatsSchema,
  PlatformScriptSchema,
  SentScriptStepSchema,
  VaultMediaSchema,
  VaultViewSchema,
  type CreatorId,
  type JobPayload,
  type Platform,
  type PlatformAccountId,
  type PlatformScript,
  type SentScriptStep,
  type VaultFolderView,
  type VaultView,
} from '@impera/contracts';
import { z } from 'zod';

import { PlatformAccountNotFound, PlatformReadUnavailable, VaultForbidden } from '../domain/errors';
import { ConnectorError, type PlatformConnector } from '../domain/platform-connector';
import type { AccountJobs, AccountStore, Clock, ConnectorAccount, JobLogger } from '../domain/ports';
import {
  compareVaultFolders,
  compareVaultOrder,
  type VaultRead,
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
  /**
   * Told of each sync that went through (ADR 0113 § 5), once its rows are written: `media` queues the description of
   * the media still without a file behind it. Thrown, the job fails and is replayed: a sync writes nothing twice.
   */
  readonly onSynced?: ((input: VaultSyncAsked) => Promise<void>) | undefined;
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
      return;
    }
    await deps.onSynced?.({
      platformAccountId: account.id,
      creatorId: account.creatorId,
      correlationId: payload.correlationId,
    });
  };
}

/** What `onVaultSyncAsked` is told: one account whose sync the owner's « Synchroniser » queued (or, `onSynced`, read). */
export interface VaultSyncAsked {
  readonly platformAccountId: PlatformAccountId;
  readonly creatorId: CreatorId;
  readonly correlationId: string;
}

/**
 * The owner's « Synchroniser » (fiche vault-sync): one `connector.vault_sync` queued for each of her accounts that may
 * be read now, then `onAsked` told of each, once, just after its own enqueue (the queue is not transactional: the job
 * is already queued when it is called). How many accounts were asked.
 */
export function createAskVaultSync(deps: {
  readonly accounts: Pick<AccountStore, 'listPollable'>;
  readonly jobs: Pick<AccountJobs, 'enqueueVaultSync'>;
  readonly platforms: readonly Platform[];
  readonly onAsked?: ((input: VaultSyncAsked) => Promise<void>) | undefined;
}) {
  return async (creatorId: CreatorId, correlationId: string): Promise<number> => {
    const theirs = (await deps.accounts.listPollable(deps.platforms)).filter(
      (account) => account.creatorId === creatorId,
    );
    for (const account of theirs) {
      await deps.jobs.enqueueVaultSync(account, correlationId);
      await deps.onAsked?.({ platformAccountId: account.id, creatorId, correlationId });
    }
    return theirs.length;
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
function vaultViewOf(creatorId: CreatorId, { rows, syncedAt }: VaultRead): VaultView {
  const folders = new Map<string, { readonly head: VaultRefRow; readonly rows: VaultRefRow[] }>();
  for (const row of rows) {
    const key = `${row.platformAccountId}|${row.folderRef ?? ''}`;
    const folder = folders.get(key);
    if (folder === undefined) folders.set(key, { head: row, rows: [row] });
    else folder.rows.push(row);
  }
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
    syncedAt: syncedAt?.toISOString() ?? null,
  });
}

export interface VaultReads {
  /** Her vault as the last sync read it, for the owner and an active manager of her list (`vault_forbidden`). */
  view(creatorId: CreatorId, userId: string): Promise<VaultView>;
}

export function createVaultReads(store: VaultStore): VaultReads {
  return {
    async view(creatorId, userId) {
      const read = await store.read(creatorId, userId);
      if (read === null) throw new VaultForbidden();
      return vaultViewOf(creatorId, read);
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
  /**
   * For the agent's script decision (ADR 0098, ADR 0018 § 5), the fan named by his platform id: the steps already sent
   * to him (`getScriptHistory`), and when a priced bundle was last offered to him, bought or not (`getFanPpvStats`).
   * `platform_read_unavailable` when the account's connector cannot tell: the agent then sells nothing.
   */
  scriptHistory(platformAccountId: PlatformAccountId, platformFanId: string): Promise<SentScriptStep[]>;
  lastOfferAt(platformAccountId: PlatformAccountId, platformFanId: string): Promise<Date | null>;
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

  async function read<T>(read: () => Promise<T>): Promise<T> {
    try {
      return await read();
    } catch (error) {
      if (error instanceof ConnectorError) {
        throw new PlatformReadUnavailable(error.code === 'session_expired' ? 'session' : 'failed');
      }
      throw error;
    }
  }

  return {
    async scripts(platformAccountId) {
      const { connector } = await connectorOf(platformAccountId);
      if (!connector.capabilities.scripts || connector.listPlatformScripts === undefined) {
        throw new PlatformReadUnavailable('unsupported');
      }
      const list = connector.listPlatformScripts.bind(connector);
      return read(async () => z.array(PlatformScriptSchema).parse(await list()));
    },
    async scriptHistory(platformAccountId, platformFanId) {
      const { account, connector } = await connectorOf(platformAccountId);
      if (!connector.capabilities.scriptHistory || connector.getScriptHistory === undefined) {
        throw new PlatformReadUnavailable('unsupported');
      }
      const history = connector.getScriptHistory.bind(connector);
      const fanRef = { platform: account.platform, id: platformFanId };
      return read(async () => z.array(SentScriptStepSchema).parse(await history(fanRef)));
    },
    async lastOfferAt(platformAccountId, platformFanId) {
      const { account, connector } = await connectorOf(platformAccountId);
      if (!connector.capabilities.ppvStats || connector.getFanPpvStats === undefined) {
        throw new PlatformReadUnavailable('unsupported');
      }
      const stats = connector.getFanPpvStats.bind(connector);
      const fanRef = { platform: account.platform, id: platformFanId };
      const { lastOfferAt } = await read(async () => FanPpvStatsSchema.parse(await stats(fanRef)));
      return lastOfferAt === null ? null : new Date(lastOfferAt);
    },
  };
}
