import {
  PlatformAccountIdSchema,
  type CreatorId,
  type ConnectionService,
  type ConnectionSignal,
  type JobPayload,
  type SalesFeedStatus,
  type TeamPlatformRemoval,
} from '@impera/contracts';
import type { Database, EncryptionKey } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { OutboundSender } from '../conversations';

import { createConnectorReads, type ConnectorReads } from './application/connector-reads';
import { createDispatchJob } from './application/dispatch';
import { createReadLinkHoursJob } from './application/link-hours';
import { createLinkServiceSettings, type DetectedLinks } from './application/link-service';
import { createOutboundSender, type ConnectorWrites } from './application/outbound-sender';
import { createPollJob } from './application/poll';
import {
  createAskConversationRead,
  createReadConversationJob,
  type ConversationReadAsk,
} from './application/read-conversation';
import { tellingSessionDeaths } from './application/read-health';
import { createReconcileJob } from './application/reconcile';
import { createConnectorResolver } from './application/resolver';
import { createSalesFeeds, type SalesFeedDeps } from './application/sales-feed';
import { createConnectorSessions, type ConnectorSessions } from './application/sessions';
import {
  createAskVaultSync,
  createPlatformReads,
  createVaultPreview,
  createVaultReads,
  createVaultSyncJob,
  type PlatformReads,
  type VaultReads,
  type VaultSyncAsked,
} from './application/vault';
import { createVaultFiles, type VaultFiles } from './application/vault-files';
import type { AvatarPorts } from './domain/avatar';
import { connectionServiceOf } from './domain/connection-outage';
import type { LinkServiceReader } from './domain/link-service';
import type { Clock, ConnectorRegistry, IngestMessage, JobLogger } from './domain/ports';
import { readServiceOf, type ReadHealth } from './domain/read-health';
import type { SalesFeedFactory, SalesFeedRegistry } from './domain/sales-feed';
import { createAvatarRecords } from './infra/avatar/avatar-records';
import { createDrizzleAccountJobs, createDrizzleAccountStore } from './infra/db/account-store';
import { createDrizzleConnectorReadsStore } from './infra/db/connector-reads-store';
import { createDrizzleDailyStatsStore } from './infra/db/daily-stats-store';
import { createDrizzleLinkHourStore } from './infra/db/link-hours-store';
import { createLinkServiceKeyStore, resealLinkServiceKey } from './infra/db/link-service-key';
import { createSalesFeedKeyStore, resealSalesFeedKeys, type ResealReport } from './infra/db/sales-feed-keys';
import {
  createSalesFeedJobs,
  createSalesFeedWebhookStore,
  resealSalesFeedWebhookSecrets,
} from './infra/db/sales-feed-webhooks';
import { createDrizzleSalesLedger } from './infra/db/sales-ledger';
import { createSendJournal } from './infra/db/send-journal';
import { createDrizzleTeamImportStore, invitationChatterLinks } from './infra/db/team-import-store';
import { createDrizzleVaultStore } from './infra/db/vault-store';
import { createAvatarRoutes } from './infra/http/avatar-routes';
import {
  createCreatorEarningsReader,
  createCreatorEarningsRoutes,
} from './infra/http/creator-earnings-routes';
import { createLinkServiceRoutes, type LinkServiceRoutesOptions } from './infra/http/link-service-routes';
import { createConnectorRoutes } from './infra/http/routes';
import { createSalesFeedDeliveryRoutes } from './infra/http/sales-feed-delivery-routes';
import { createSalesFeedRoutes, type SalesFeedRoutesOptions } from './infra/http/sales-feed-routes';
import {
  createSalesFeedTeamRoutes,
  type SalesFeedTeamRoutesOptions,
} from './infra/http/sales-feed-team-routes';
import { createVaultRoutes, type VaultRoutesOptions } from './infra/http/vault-routes';
import { revealSessionShape } from './infra/reveal/session';
import { createRevealSalesFeed, isPlausibleRevealKey, type SalesFeedFetch } from './infra/reveal-crm/adapter';
import { readRevealDelivery } from './infra/reveal-crm/delivery';
import { createSessionVault } from './infra/session-vault';

export type { AvatarPorts } from './domain/avatar';
export { confinePinnedGets, createAvatarFetch } from './infra/avatar/fetch-avatar';
export { LinkServiceError, type LinkServiceReader } from './domain/link-service';
export { createLinkServiceReader } from './infra/link-service/rest-link-service';
export { createS3AvatarStore } from './infra/avatar/s3-avatar-store';
export type { ConnectorRegistry } from './domain/ports';
export type { SalesFeedRegistry } from './domain/sales-feed';
export type { InviteFromPlatform } from './infra/http/sales-feed-team-routes';
export type { SalesFeedFetch } from './infra/reveal-crm/adapter';
/** @public A creator's own sales, read from her view inside `withCreatorAccount` (CRM-04 lot d): her Ventes screen's. */
export { creatorSalesReads } from './infra/db/creator-sales-reads';
/** @public What pay reads of the sales feed, in its transaction (ADR 0050 §§ 5, 7, 8; CRM-03): Équipe's recalculation. */
export { salesFeedReadsForPay } from './infra/db/pay-reads';
/** @public The lines pay reads, their author and the range of a read (CRM-03). */
export type { PaySaleAuthor, PaySaleLine, PaySalesOfKeys, PaySalesRange } from './infra/db/pay-reads';
/** @public What the team's pay rules read before an account switches to the platform's net (ADR 0050 § 8, CRM-03). */
export { salesFeedSwitchReads } from './infra/db/switch-reads';
/** @public What a declared report is compared with (ADR 0073 § 2), in the caller's transaction. */
export { salesFeedReadsForReports } from './infra/db/report-reads';
/** @public The query of `salesFeedReadsForReports.shiftSales`, and what it answers. */
export type { ShiftSales, ShiftSalesQuery } from './infra/db/report-reads';
/** @public The sales totals of CRM-04, in the caller's transaction: the Dashboard's and the evening digest's one sum. */
export { salesFeedTotals } from './infra/db/totals-reads';
export { salesFeedTimeZone } from './domain/sale-days';
/**
 * The daily photo of a creator's statistics (ADR 0081 § 4, § 5), read in the caller's `withTenantMember`: the owner,
 * or an active manager when she is on his list. Counters only, never an amount.
 */
export {
  chatterStatsOf,
  dailyStatsOf,
  type ChatterStatsDay,
  type DailyStatsDay,
} from './infra/db/daily-stats-store';
/** @public Which totals a read gives (CRM-04). */
export type { SalesRefundsQuery, SalesTotalsQuery } from './infra/db/totals-reads';
export { FakeConnector } from './infra/fake/FakeConnector';
/** Reveal's private API, read with the « bot » member's captured session (P2-02): the registry's factory. */
export { revealApiConnectors } from './infra/reveal/connector';
export type { RevealFetch } from './infra/reveal/client';
export type { FileTransport } from './infra/download/vault-file';
export type { VaultFiles } from './application/vault-files';
/** @public The errors `platformReads` throws, for the adapter that reads through it (`reason` says why a read is refused). */
export { PlatformAccountNotFound, PlatformReadUnavailable } from './domain/errors';
/** @public Reveal's observed shapes, one copy: FakeReveal serves them (`__tests__/fake-reveal`). */
export {
  REVEAL_ENDPOINTS,
  RevealMediaTypeSchema,
  type RevealWireMedia,
  type RevealWireMessageItem,
} from './infra/reveal/wire';

function allReports(...reports: readonly ResealReport[]): ResealReport {
  return {
    total: reports.reduce((sum, report) => sum + report.total, 0),
    rewritten: reports.reduce((sum, report) => sum + report.rewritten, 0),
    unreadable: reports.flatMap((report) => report.unreadable),
  };
}

/**
 * `pnpm ops:reencrypt-credentials`: the sales feed keys, their webhooks' secrets and the key of the redirect service
 * re-sealed with the newest CREDENTIALS_ENCRYPTION_KEYS.
 */
export async function resealSalesFeedCredentials(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<ResealReport> {
  return allReports(
    await resealSalesFeedKeys(adminDb, keys),
    await resealSalesFeedWebhookSecrets(adminDb, keys),
    await resealLinkServiceKey(adminDb, keys),
  );
}

/**
 * `pnpm ops:check-keys`: how many sales feed keys, webhook secrets and the key of the redirect service the given
 * encryption keys open, read only, no call outside.
 */
export async function checkSalesFeedKeys(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<{ readonly total: number; readonly unreadable: readonly string[] }> {
  const report = allReports(
    await resealSalesFeedKeys(adminDb, keys, true),
    await resealSalesFeedWebhookSecrets(adminDb, keys, true),
    await resealLinkServiceKey(adminDb, keys, true),
  );
  return { total: report.total, unreadable: report.unreadable };
}

/**
 * Reveal's sales feed (ADR 0050): its CRM API, at `baseUrl` (Reveal's own by default; FakeReveal in the tests). No
 * call is made until the owner pastes a key.
 */
export function revealSalesFeed(fetch: SalesFeedFetch, baseUrl?: string): SalesFeedFactory {
  return {
    create: (key) => createRevealSalesFeed({ key, fetch, ...(baseUrl === undefined ? {} : { baseUrl }) }),
    isPlausibleKey: isPlausibleRevealKey,
    readDelivery: readRevealDelivery,
  };
}

/** Public entry point of the `connectors` module (ADR 0002). Other modules import this file only. */
export interface ConnectorsModule {
  readonly name: 'connectors';
  /** Implements the `conversations` port; the composition root hands it over. */
  readonly outboundSender: OutboundSender;
  /**
   * The other writes of ADR 0018 (script step, client note, read mark, typing), behind the same write guard as the
   * sends (P2-03). No caller yet: the selling engine and the fan card will use them.
   */
  readonly writes: ConnectorWrites;
  readonly sessions: ConnectorSessions;
  /** Mounted under `/v1` by the server. */
  readonly routes: FastifyPluginAsyncZod;
  /** Handlers of the module's jobs; the composition root registers them with Graphile Worker. */
  readonly jobs: {
    dispatch(logger: JobLogger): Promise<void>;
    poll(payload: JobPayload<'connector.poll'>, logger: JobLogger): Promise<void>;
    reconcile(payload: JobPayload<'connector.reconcile'>, logger: JobLogger): Promise<void>;
    /** One conversation the copilot opened and no poll read (recette du 16/11). */
    readConversation(payload: JobPayload<'connector.read_conversation'>, logger: JobLogger): Promise<void>;
    /** Every connected sales feed, from its cursor (ADR 0050 § 3); `woken` by a webhook delivery: now. */
    readSales(logger: JobLogger, correlationId: string, woken?: boolean): Promise<void>;
    /** The automatic check of the fortnight just over, or its second look a day later (CRM-04 b3). */
    checkSales(
      payload: JobPayload<'connector.check_sales'>,
      logger: JobLogger,
      correlationId: string,
    ): Promise<void>;
    /** Her photo copied from the platform to the media bucket, after her import (CRM-07 a2b). */
    copyAvatar(payload: JobPayload<'connector.copy_avatar'>, logger: JobLogger): Promise<void>;
    /** The platform's daily statistics of each linked account, kept as counters (ADR 0081 § 3). */
    readDailyStats(logger: JobLogger, correlationId: string): Promise<void>;
    /** The hours of every attached redirect link, one creator at a time (ADR 0120 § 3). */
    readLinkHours(logger: JobLogger): Promise<void>;
    /** Her vault's folders and media mirrored in the CRM, read only (ADR 0099, fiche vault-sync). */
    vaultSync(payload: JobPayload<'connector.vault_sync'>, logger: JobLogger): Promise<void>;
  };
  /**
   * `/v1/creators/:creatorId/vault` and its owner's « Synchroniser » (fiche vault-sync), behind the guards given here.
   * Nothing else starts a read of the platform's vault: no cron.
   */
  /**
   * The copilot panel found a conversation Impera never read (recette du 16/11): its read queued on the accounts of
   * these creators on that platform, at most once a minute per conversation. How many reads were queued.
   */
  readonly askConversationRead: (ask: ConversationReadAsk) => Promise<number>;
  readonly vaultRoutes: (options: Omit<VaultRoutesOptions, 'askSync' | 'preview'>) => FastifyPluginAsyncZod;
  /** Her vault as the last sync read it, as the person reading (the owner, an active manager of her list). */
  readonly vault: VaultReads;
  /**
   * Reads of the platform for another module's adapter (the import of the scripts by `scripts`): through the resolver,
   * each behind its `capabilities` flag, never a write.
   */
  readonly platformReads: PlatformReads;
  /**
   * Her bio on her platform profile as the poll last read it (ADR 0154), for the agent beside her persona; `null`:
   * none. Read from the base, never from the platform at draft time.
   */
  readonly profileBioOf: (creatorId: CreatorId) => Promise<string | null>;
  /**
   * One vault file read to a path of the caller's (ADR 0113), for `media.describe_vault`: through the resolver, behind
   * `mediaDownload`, never a write. What became of it, typed; the file is the caller's to remove.
   */
  readonly vaultFiles: VaultFiles;
  /** `/v1/creators/:creatorId/avatar`, behind the guard given here (owner, operator, creator). */
  readonly avatarRoutes: (guard: preValidationAsyncHookHandler) => FastifyPluginAsyncZod;
  /** `/v1/creator-space/earnings` (CR-04), behind the guard given here (creator): her part, read in her account. */
  readonly creatorEarningsRoutes: (guard: preValidationAsyncHookHandler) => FastifyPluginAsyncZod;
  /**
   * Every link of the agency's account at the redirect service (ADR 0120 § 3), read now, for « Détecter ses liens »:
   * for the owner alone, never stored here.
   */
  readonly detectedLinks: () => Promise<DetectedLinks>;
  /** `/v1/settings/link-service`, behind the guards given here: the agency's key of the redirect service. */
  readonly linkServiceRoutes: (options: LinkServiceRoutesOptions) => FastifyPluginAsyncZod;
  /** `/v1/settings/sales-feeds`, behind the guards given here. */
  readonly salesFeedRoutes: (options: SalesFeedRoutesOptions) => FastifyPluginAsyncZod;
  /**
   * `/v1/settings/sales-feeds/:platform/team` (ADR 0076), behind the guard given here (owner, operator): the base
   * keeps it to the owner and the active managers. Its invitation (§ 3) is `team`'s, given here too.
   */
  readonly salesFeedTeamRoutes: (options: SalesFeedTeamRoutesOptions) => FastifyPluginAsyncZod;
  /** Every platform's feed as Réglages › Ventes shows it, never the key: the Dashboard names a stopped one (AGT-11). */
  readonly salesFeedStates: () => Promise<SalesFeedStatus[]>;
  /**
   * The link an invitation from the review poses (ADR 0076 § 3), for `team`'s port: run in the inviter's own
   * transaction, under the policies of migration 0135.
   */
  readonly invitationChatterLinks: typeof invitationChatterLinks;
  /**
   * The members still in the team whose platform account was removed or is absent from the list (ADR 0076 § 5), as
   * this viewer may see them: `team` shows the warning on the member's page. Read from the base, never the platform.
   */
  readonly teamRemovals: (userId: string) => Promise<TeamPlatformRemoval[]>;
  /**
   * The sales, the daily statistics and the imported team for another module's adapter (ADR 0026 § 1, ADR 0105 § 4:
   * the MCP), as the person reading, bounded by the creators named; never a share, never a call to the platform.
   */
  readonly reads: ConnectorReads;
  /** `/v1/webhooks/sales-feeds/:platform`: public, each delivery checked against its webhook's secret. */
  readonly salesFeedDeliveryRoutes: FastifyPluginAsyncZod;
}

export interface ConnectorsDeps {
  /** Application role (RLS). */
  readonly db: Database;
  /** Owner role: the dispatcher and the device route look across creators. */
  readonly adminDb: Database;
  /** `conversations.ingestMessage`. */
  readonly ingest: IngestMessage;
  /** One factory per platform with an adapter; empty until Reveal's (phase 1). */
  readonly registry: ConnectorRegistry;
  /** `SESSION_ENCRYPTION_KEYS`; without them sessions can be neither stored nor read. */
  readonly sessionKeys: readonly EncryptionKey[] | null;
  /**
   * The person an extension link names (ADR 0066 § 7), late bound by the composition root to `trends`' link holder;
   * `null` for a link that names nobody. Only the owner's syncs a session.
   */
  readonly linkUser: (token: string) => Promise<{ readonly id: string; readonly role: string } | null>;
  /**
   * CREDENTIALS_ENCRYPTION_KEYS, the AI keys' (ADR 0050 § 4); without them no sales feed key can be kept and nothing is
   * read.
   */
  readonly credentialKeys: readonly EncryptionKey[] | null;
  /** One factory per platform with a sales feed: Reveal's CRM API. */
  readonly salesFeeds: SalesFeedRegistry;
  /**
   * The redirect service read with a key (ADR 0120 § 3), bound by the composition root to the address the deployment
   * gives; `null` or absent without one, and the link connector is off.
   */
  readonly linkServiceReaderOf?: ((key: string) => LinkServiceReader) | null;
  /**
   * Impera's public HTTPS address (AUTH_BASE_URL), where a platform posts its deliveries; `null` (development over
   * HTTP) and no webhook can be registered: the minute's reading alone brings the sales.
   */
  readonly publicBaseUrl: string | null;
  /**
   * The recette sandbox (ADR 0075): `publicBaseUrl` is this machine over plain HTTP, where the fake world posts its
   * deliveries. Never set outside the sandbox, which the configuration refuses in production.
   */
  readonly loopbackWebhooks?: boolean;
  /**
   * The accounts paid on the platform's net over the whole of a fortnight (CRM-04 b3): the `scheduling` module's
   * `salesCheckReads`, read on the admin connection by the composition root. Never a write of the pay rules.
   */
  readonly detectedAccounts: SalesFeedDeps['detectedAccounts'];
  /**
   * `connection_state_changed` (Telegram P3-12), wired by the composition root: Reveal's register is the service
   * `reveal_crm`, the AI's read of its messages `reveal_read` (27/11/2026); the outbox keeps the transitions only.
   */
  readonly publishConnectionState?: (
    service: ConnectionService,
    signal: ConnectionSignal,
    correlationId: string,
  ) => Promise<unknown>;
  readonly clock?: Clock;
  readonly random?: () => number;
  /**
   * Her photo's copy at import (CRM-07 a2b), wired by the composition root: the platform's image fetched, sniffed and
   * re-encoded, kept in the media bucket. `null` without a bucket (`S3_*`): her initials stay. `creators.avatar_key`
   * is the module's own.
   */
  readonly avatars?: Omit<AvatarPorts, 'records'> | null;
  /**
   * Told of each `connector.vault_sync` the owner's « Synchroniser » queued, once per account, just after its enqueue
   * (fiche vault-sync; asked by `media`, wired by the composition root). Never a write of this module's tables.
   */
  readonly onVaultSyncAsked?: (input: VaultSyncAsked) => Promise<void>;
  /**
   * Told of each `connector.vault_sync` that went through, once its rows are written (ADR 0113 § 5; `media` queues the
   * description of the vault behind it, wired by the composition root). Never a write of this module's tables.
   */
  readonly onVaultSynced?: (input: VaultSyncAsked) => Promise<void>;
}

const systemClock: Clock = { now: () => new Date() };

export function createConnectorsModule(deps: ConnectorsDeps): ConnectorsModule {
  const clock = deps.clock ?? systemClock;
  const publish = deps.publishConnectionState;
  // The AI's read of the fans' messages, told to the owners when it stops and when it comes back (décision du 27/11).
  const readHealth: ReadHealth | undefined =
    publish === undefined
      ? undefined
      : async (platform, signal, correlationId) => {
          const service = readServiceOf(platform);
          if (service !== null) await publish(service, signal, correlationId);
        };
  const accounts = tellingSessionDeaths(createDrizzleAccountStore(deps.db, deps.adminDb), readHealth);
  const vault = deps.sessionKeys === null ? null : createSessionVault(deps.sessionKeys);
  const resolver = createConnectorResolver({
    accounts,
    vault,
    registry: deps.registry,
    sends: (account) => createSendJournal(deps.db, account),
  });
  const ledger = createDrizzleSalesLedger(deps.db, deps.adminDb);
  const sessions = createConnectorSessions({
    accounts,
    vault,
    clock,
    shapes: { reveal: revealSessionShape },
    modelLinks: async (platform) =>
      new Map(
        [...(await ledger.modelLinks(platform))].map(([platformModelId, link]) => [
          platformModelId,
          PlatformAccountIdSchema.parse(link.platformAccountId),
        ]),
      ),
  });
  const accountJobs = { accounts, resolver, ingest: deps.ingest, clock };
  const pollJobs = readHealth === undefined ? accountJobs : { ...accountJobs, readHealth };
  const avatars: AvatarPorts | null =
    deps.avatars == null ? null : { ...deps.avatars, records: createAvatarRecords(deps.adminDb) };
  const teamStore = createDrizzleTeamImportStore(deps.db);
  const salesFeeds = createSalesFeeds({
    keys: deps.credentialKeys === null ? null : createSalesFeedKeyStore(deps.adminDb, deps.credentialKeys),
    ledger,
    team: teamStore,
    registry: deps.salesFeeds,
    clock,
    webhooks:
      deps.credentialKeys === null ? null : createSalesFeedWebhookStore(deps.adminDb, deps.credentialKeys),
    jobs: createSalesFeedJobs(deps.adminDb),
    webhookUrl: (platform) =>
      salesFeedWebhookUrl(deps.publicBaseUrl, platform, deps.loopbackWebhooks === true),
    detectedAccounts: deps.detectedAccounts,
    connectionState: async (platform, signal, correlationId) => {
      const service = connectionServiceOf(platform);
      if (service === null || deps.publishConnectionState === undefined) return;
      await deps.publishConnectionState(service, signal, correlationId);
    },
    avatars,
    dailyStats: createDrizzleDailyStatsStore(deps.db, deps.adminDb),
  });
  const sender = createOutboundSender({ accounts, resolver, clock });
  const linkServiceReaderOf = deps.linkServiceReaderOf ?? null;
  const linkServiceKeys =
    deps.credentialKeys === null || linkServiceReaderOf === null
      ? null
      : createLinkServiceKeyStore(deps.adminDb, deps.credentialKeys);
  const linkService = createLinkServiceSettings({
    keys: linkServiceKeys,
    readerOf: linkServiceReaderOf,
    now: () => clock.now(),
  });
  const readLinkHours = createReadLinkHoursJob({
    keys: linkServiceKeys,
    readerOf: linkServiceReaderOf,
    store: createDrizzleLinkHourStore(deps.db, deps.adminDb),
    now: () => clock.now(),
  });
  const accountJobQueue = createDrizzleAccountJobs(deps.adminDb);
  const vaultStore = createDrizzleVaultStore(deps.db);
  const vaultReads = createVaultReads(vaultStore);
  const askVaultSync = createAskVaultSync({
    accounts,
    jobs: accountJobQueue,
    platforms: resolver.platforms,
    onAsked: deps.onVaultSyncAsked,
  });
  return {
    name: 'connectors',
    outboundSender: sender,
    writes: sender,
    sessions,
    routes: createConnectorRoutes({ sessions, accounts, linkUser: deps.linkUser }),
    jobs: {
      dispatch: createDispatchJob({
        accounts,
        jobs: accountJobQueue,
        resolver,
        clock,
        ...(deps.random === undefined ? {} : { random: deps.random }),
      }),
      poll: createPollJob(pollJobs),
      reconcile: createReconcileJob(accountJobs),
      readConversation: createReadConversationJob(accountJobs),
      readSales: (logger, correlationId, woken = false) => salesFeeds.read(logger, correlationId, woken),
      checkSales: (payload, logger, correlationId) => salesFeeds.autoCheck(payload, logger, correlationId),
      readDailyStats: (logger, correlationId) => salesFeeds.readDailyStats(logger, correlationId),
      readLinkHours: async (logger) => {
        await readLinkHours(logger);
      },
      copyAvatar: (payload, logger) => salesFeeds.copyAvatar(payload, logger),
      vaultSync: createVaultSyncJob({
        accounts,
        resolver,
        store: vaultStore,
        clock,
        onSynced: deps.onVaultSynced,
      }),
    },
    askConversationRead: createAskConversationRead({
      accounts,
      jobs: accountJobQueue,
      platforms: resolver.platforms,
      clock,
    }),
    vaultRoutes: (options) =>
      createVaultRoutes(vaultReads, {
        ...options,
        askSync: askVaultSync,
        preview: createVaultPreview({ accounts, resolver, store: vaultStore, clock }),
      }),
    vault: vaultReads,
    platformReads: createPlatformReads({ accounts, resolver, clock }),
    profileBioOf: (creatorId) => accounts.profileBioOf(creatorId),
    vaultFiles: createVaultFiles({ accounts, resolver, clock }),
    avatarRoutes: (guard) => createAvatarRoutes(avatars, guard),
    creatorEarningsRoutes: (guard) =>
      createCreatorEarningsRoutes(createCreatorEarningsReader(deps.db), guard, () => clock.now()),
    linkServiceRoutes: (options) => createLinkServiceRoutes(linkService, options),
    detectedLinks: () => linkService.detectedLinks(),
    salesFeedRoutes: (options) => createSalesFeedRoutes(salesFeeds, options),
    salesFeedTeamRoutes: (options) => createSalesFeedTeamRoutes(salesFeeds.team, options),
    salesFeedStates: () => salesFeeds.list(),
    invitationChatterLinks,
    teamRemovals: (userId) => salesFeeds.team.removals(userId),
    reads: createConnectorReads({ store: createDrizzleConnectorReadsStore(deps.db), team: teamStore }),
    salesFeedDeliveryRoutes: createSalesFeedDeliveryRoutes(salesFeeds),
  };
}

/**
 * Where a platform posts its deliveries; only over HTTPS, the platform would refuse anything else, except this machine
 * over HTTP in the recette sandbox (`loopback`, ADR 0075).
 */
function salesFeedWebhookUrl(base: string | null, platform: string, loopback: boolean): string | null {
  if (base === null) return null;
  const url = new URL(`v1/webhooks/sales-feeds/${platform}`, base.endsWith('/') ? base : `${base}/`);
  if (url.protocol === 'https:') return url.toString();
  return loopback && url.protocol === 'http:' && url.hostname === '127.0.0.1' ? url.toString() : null;
}
