import type { JobPayload } from '@nirvana/contracts';
import type { Database, EncryptionKey } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { OutboundSender } from '../conversations';

import { createDispatchJob } from './application/dispatch';
import { createOutboundSender } from './application/outbound-sender';
import { createPollJob } from './application/poll';
import { createReconcileJob } from './application/reconcile';
import { createConnectorResolver } from './application/resolver';
import { createSalesFeeds } from './application/sales-feed';
import { createConnectorSessions, type ConnectorSessions } from './application/sessions';
import type { Clock, ConnectorRegistry, IngestMessage, JobLogger } from './domain/ports';
import type { SalesFeedFactory, SalesFeedRegistry } from './domain/sales-feed';
import { createDrizzleAccountJobs, createDrizzleAccountStore } from './infra/db/account-store';
import { createSalesFeedKeyStore, resealSalesFeedKeys, type ResealReport } from './infra/db/sales-feed-keys';
import { createDrizzleSalesLedger } from './infra/db/sales-ledger';
import { createConnectorRoutes } from './infra/http/routes';
import { createSalesFeedRoutes, type SalesFeedRoutesOptions } from './infra/http/sales-feed-routes';
import { createRevealSalesFeed, isPlausibleRevealKey, type SalesFeedFetch } from './infra/reveal-crm/adapter';
import { createSessionVault } from './infra/session-vault';

export type { ConnectorRegistry } from './domain/ports';
export type { SalesFeedRegistry } from './domain/sales-feed';
export type { SalesFeedFetch } from './infra/reveal-crm/adapter';
export { FakeConnector } from './infra/fake/FakeConnector';

/** `pnpm ops:reencrypt-credentials`: the sales feed keys re-sealed with the newest CREDENTIALS_ENCRYPTION_KEYS. */
export function resealSalesFeedCredentials(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<ResealReport> {
  return resealSalesFeedKeys(adminDb, keys);
}

/** `pnpm ops:check-keys`: how many sales feed keys the given encryption keys open, read only, no call to Reveal. */
export async function checkSalesFeedKeys(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<{ readonly total: number; readonly unreadable: readonly string[] }> {
  const report = await resealSalesFeedKeys(adminDb, keys, true);
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
    /** Every connected sales feed, from its cursor (ADR 0050 § 3). */
    readSales(logger: JobLogger, correlationId: string): Promise<void>;
  };
  /** `/v1/settings/sales-feeds`, behind the guards given here. */
  readonly salesFeedRoutes: (options: SalesFeedRoutesOptions) => FastifyPluginAsyncZod;
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
  readonly clock?: Clock;
  readonly random?: () => number;
}

const systemClock: Clock = { now: () => new Date() };

export function createConnectorsModule(deps: ConnectorsDeps): ConnectorsModule {
  const clock = deps.clock ?? systemClock;
  const accounts = createDrizzleAccountStore(deps.db, deps.adminDb);
  const vault = deps.sessionKeys === null ? null : createSessionVault(deps.sessionKeys);
  const resolver = createConnectorResolver({ accounts, vault, registry: deps.registry });
  const sessions = createConnectorSessions({ accounts, vault, clock });
  const accountJobs = { accounts, resolver, ingest: deps.ingest, clock };
  const salesFeeds = createSalesFeeds({
    keys: deps.credentialKeys === null ? null : createSalesFeedKeyStore(deps.adminDb, deps.credentialKeys),
    ledger: createDrizzleSalesLedger(deps.db, deps.adminDb),
    registry: deps.salesFeeds,
    clock,
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
      readSales: (logger, correlationId) => salesFeeds.read(logger, correlationId),
    },
    salesFeedRoutes: (options) => createSalesFeedRoutes(salesFeeds, options),
  };
}
