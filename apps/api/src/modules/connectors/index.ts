import type { ConnectionService, ConnectionSignal, JobPayload, TeamPlatformRemoval } from '@impera/contracts';
import type { Database, EncryptionKey } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { OutboundSender } from '../conversations';

import { createDispatchJob } from './application/dispatch';
import { createOutboundSender } from './application/outbound-sender';
import { createPollJob } from './application/poll';
import { createReconcileJob } from './application/reconcile';
import { createConnectorResolver } from './application/resolver';
import { createSalesFeeds, type SalesFeedDeps } from './application/sales-feed';
import { createConnectorSessions, type ConnectorSessions } from './application/sessions';
import type { AvatarPorts } from './domain/avatar';
import { connectionServiceOf } from './domain/connection-outage';
import type { Clock, ConnectorRegistry, IngestMessage, JobLogger } from './domain/ports';
import type { SalesFeedFactory, SalesFeedRegistry } from './domain/sales-feed';
import { createAvatarRecords } from './infra/avatar/avatar-records';
import { createDrizzleAccountJobs, createDrizzleAccountStore } from './infra/db/account-store';
import { createSalesFeedKeyStore, resealSalesFeedKeys, type ResealReport } from './infra/db/sales-feed-keys';
import {
  createSalesFeedJobs,
  createSalesFeedWebhookStore,
  resealSalesFeedWebhookSecrets,
} from './infra/db/sales-feed-webhooks';
import { createDrizzleSalesLedger } from './infra/db/sales-ledger';
import { createDrizzleTeamImportStore, invitationChatterLinks } from './infra/db/team-import-store';
import { createAvatarRoutes } from './infra/http/avatar-routes';
import { createConnectorRoutes } from './infra/http/routes';
import { createSalesFeedDeliveryRoutes } from './infra/http/sales-feed-delivery-routes';
import { createSalesFeedRoutes, type SalesFeedRoutesOptions } from './infra/http/sales-feed-routes';
import { createSalesFeedTeamRoutes } from './infra/http/sales-feed-team-routes';
import { createRevealSalesFeed, isPlausibleRevealKey, type SalesFeedFetch } from './infra/reveal-crm/adapter';
import { readRevealDelivery } from './infra/reveal-crm/delivery';
import { createSessionVault } from './infra/session-vault';

export type { AvatarPorts } from './domain/avatar';
export { createAvatarFetch } from './infra/avatar/fetch-avatar';
export { createS3AvatarStore } from './infra/avatar/s3-avatar-store';
export type { ConnectorRegistry } from './domain/ports';
export type { SalesFeedRegistry } from './domain/sales-feed';
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
/** @public Which totals a read gives (CRM-04). */
export type { SalesRefundsQuery, SalesTotalsQuery } from './infra/db/totals-reads';
export { FakeConnector } from './infra/fake/FakeConnector';

function bothReports(keys: ResealReport, webhooks: ResealReport): ResealReport {
  return {
    total: keys.total + webhooks.total,
    rewritten: keys.rewritten + webhooks.rewritten,
    unreadable: [...keys.unreadable, ...webhooks.unreadable],
  };
}

/**
 * `pnpm ops:reencrypt-credentials`: the sales feed keys and their webhooks' secrets re-sealed with the newest
 * CREDENTIALS_ENCRYPTION_KEYS.
 */
export async function resealSalesFeedCredentials(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<ResealReport> {
  return bothReports(
    await resealSalesFeedKeys(adminDb, keys),
    await resealSalesFeedWebhookSecrets(adminDb, keys),
  );
}

/**
 * `pnpm ops:check-keys`: how many sales feed keys and webhook secrets the given encryption keys open, read only, no
 * call to Reveal.
 */
export async function checkSalesFeedKeys(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<{ readonly total: number; readonly unreadable: readonly string[] }> {
  const report = bothReports(
    await resealSalesFeedKeys(adminDb, keys, true),
    await resealSalesFeedWebhookSecrets(adminDb, keys, true),
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
  readonly sessions: ConnectorSessions;
  /** Mounted under `/v1` by the server. */
  readonly routes: FastifyPluginAsyncZod;
  /** Handlers of the module's jobs; the composition root registers them with Graphile Worker. */
  readonly jobs: {
    dispatch(logger: JobLogger): Promise<void>;
    poll(payload: JobPayload<'connector.poll'>, logger: JobLogger): Promise<void>;
    reconcile(payload: JobPayload<'connector.reconcile'>, logger: JobLogger): Promise<void>;
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
  };
  /** `/v1/creators/:creatorId/avatar`, behind the guard given here (owner, operator, creator). */
  readonly avatarRoutes: (guard: preValidationAsyncHookHandler) => FastifyPluginAsyncZod;
  /** `/v1/settings/sales-feeds`, behind the guards given here. */
  readonly salesFeedRoutes: (options: SalesFeedRoutesOptions) => FastifyPluginAsyncZod;
  /**
   * `/v1/settings/sales-feeds/:platform/team` (ADR 0076), behind the guard given here (owner, operator): the base
   * keeps it to the owner and the active managers.
   */
  readonly salesFeedTeamRoutes: (guard: preValidationAsyncHookHandler) => FastifyPluginAsyncZod;
  /**
   * The link an invitation from the review poses (ADR 0076 § 3), for `team`'s port: run in the inviter's own
   * transaction, under the policies of migration 0132.
   */
  readonly invitationChatterLinks: typeof invitationChatterLinks;
  /**
   * The members still in the team whose platform account was removed or is absent from the list (ADR 0076 § 5), as
   * this viewer may see them: `team` shows the warning on the member's page. Read from the base, never the platform.
   */
  readonly teamRemovals: (userId: string) => Promise<TeamPlatformRemoval[]>;
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
  /** `EXTENSION_DEVICE_TOKEN`; without it the extension's route refuses everything. */
  readonly deviceToken: string | null;
  /**
   * CREDENTIALS_ENCRYPTION_KEYS, the AI keys' (ADR 0050 § 4); without them no sales feed key can be kept and nothing is
   * read.
   */
  readonly credentialKeys: readonly EncryptionKey[] | null;
  /** One factory per platform with a sales feed: Reveal's CRM API. */
  readonly salesFeeds: SalesFeedRegistry;
  /**
   * Impera's public HTTPS address (AUTH_BASE_URL), where a platform posts its deliveries; `null` (development over
   * HTTP) and no webhook can be registered: the minute's reading alone brings the sales.
   */
  readonly publicBaseUrl: string | null;
  /**
   * The accounts paid on the platform's net over the whole of a fortnight (CRM-04 b3): the `scheduling` module's
   * `salesCheckReads`, read on the admin connection by the composition root. Never a write of the pay rules.
   */
  readonly detectedAccounts: SalesFeedDeps['detectedAccounts'];
  /**
   * `connection_state_changed` (Telegram P3-12), wired by the composition root: Reveal's register is the service
   * `reveal_crm`; the outbox keeps the transitions only.
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
}

const systemClock: Clock = { now: () => new Date() };

export function createConnectorsModule(deps: ConnectorsDeps): ConnectorsModule {
  const clock = deps.clock ?? systemClock;
  const accounts = createDrizzleAccountStore(deps.db, deps.adminDb);
  const vault = deps.sessionKeys === null ? null : createSessionVault(deps.sessionKeys);
  const resolver = createConnectorResolver({ accounts, vault, registry: deps.registry });
  const sessions = createConnectorSessions({ accounts, vault, clock });
  const accountJobs = { accounts, resolver, ingest: deps.ingest, clock };
  const avatars: AvatarPorts | null =
    deps.avatars == null ? null : { ...deps.avatars, records: createAvatarRecords(deps.adminDb) };
  const salesFeeds = createSalesFeeds({
    keys: deps.credentialKeys === null ? null : createSalesFeedKeyStore(deps.adminDb, deps.credentialKeys),
    ledger: createDrizzleSalesLedger(deps.db, deps.adminDb),
    team: createDrizzleTeamImportStore(deps.db),
    registry: deps.salesFeeds,
    clock,
    webhooks:
      deps.credentialKeys === null ? null : createSalesFeedWebhookStore(deps.adminDb, deps.credentialKeys),
    jobs: createSalesFeedJobs(deps.adminDb),
    webhookUrl: (platform) => salesFeedWebhookUrl(deps.publicBaseUrl, platform),
    detectedAccounts: deps.detectedAccounts,
    connectionState: async (platform, signal, correlationId) => {
      const service = connectionServiceOf(platform);
      if (service === null || deps.publishConnectionState === undefined) return;
      await deps.publishConnectionState(service, signal, correlationId);
    },
    avatars,
  });
  return {
    name: 'connectors',
    outboundSender: createOutboundSender({ accounts, resolver, clock }),
    sessions,
    routes: createConnectorRoutes(sessions, deps.deviceToken),
    jobs: {
      dispatch: createDispatchJob({
        accounts,
        jobs: createDrizzleAccountJobs(deps.adminDb),
        resolver,
        clock,
        ...(deps.random === undefined ? {} : { random: deps.random }),
      }),
      poll: createPollJob(accountJobs),
      reconcile: createReconcileJob(accountJobs),
      readSales: (logger, correlationId, woken = false) => salesFeeds.read(logger, correlationId, woken),
      checkSales: (payload, logger, correlationId) => salesFeeds.autoCheck(payload, logger, correlationId),
      copyAvatar: (payload, logger) => salesFeeds.copyAvatar(payload, logger),
    },
    avatarRoutes: (guard) => createAvatarRoutes(avatars, guard),
    salesFeedRoutes: (options) => createSalesFeedRoutes(salesFeeds, options),
    salesFeedTeamRoutes: (guard) => createSalesFeedTeamRoutes(salesFeeds.team, guard),
    invitationChatterLinks,
    teamRemovals: (userId) => salesFeeds.team.removals(userId),
    salesFeedDeliveryRoutes: createSalesFeedDeliveryRoutes(salesFeeds),
  };
}

/** Where a platform posts its deliveries; only over HTTPS, the platform would refuse anything else. */
function salesFeedWebhookUrl(base: string | null, platform: string): string | null {
  if (base === null) return null;
  const url = new URL(`v1/webhooks/sales-feeds/${platform}`, base.endsWith('/') ? base : `${base}/`);
  return url.protocol === 'https:' ? url.toString() : null;
}
