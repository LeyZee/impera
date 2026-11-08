import { JOB_PAYLOADS } from '@impera/contracts';
import { parseEncryptionKeys, withAdmin } from '@impera/db';

import { mediaBucket, secretOrNull } from '../config';
import { createConnectionStatePublisher } from '../connection-state';
import { defineTask } from '../jobs';
import {
  createAvatarFetch,
  createConnectorsModule,
  createS3AvatarStore,
  revealSalesFeed,
  type AvatarPorts,
  type ConnectorRegistry,
  type ConnectorsDeps,
  type ConnectorsModule,
  type InviteFromPlatform,
  type SalesFeedRegistry,
} from '../modules/connectors';
import { createFfmpegMediaTools, sniffMediaType } from '../modules/media';
import { salesCheckReads } from '../modules/scheduling';
import { sandboxOf } from '../sandbox';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredConnectors {
  readonly module: ConnectorsModule;
  readonly tasks: TasksOf<'connector'>;
  readonly routes: readonly Routes[];
}

export function wireConnectors(
  shared: Shared,
  deps: {
    /** Called by the jobs only, once `conversations` exists (the two modules need each other's port). */
    readonly ingest: ConnectorsDeps['ingest'];
    /** `team`'s invitation from a link proposal (ADR 0076 § 3), late bound: `team` is wired after this module. */
    readonly invite: InviteFromPlatform;
    /** Reveal's adapter arrives with phase 1 (ADR 0008); until then no account is polled. */
    readonly registry: ConnectorRegistry;
    /** Reveal's CRM API (ADR 0050) by default; FakeReveal's in the tests. */
    readonly salesFeeds?: SalesFeedRegistry;
    /** Tests only: the connectors' clock. */
    readonly now?: () => Date;
    /** Tests only: the photo copy's fetch and store (CRM-07 a2b). */
    readonly avatars?: Pick<AvatarPorts, 'fetch' | 'store'>;
  },
): WiredConnectors {
  const { config, db, adminDb, logger, requireRole, recentLogin } = shared;
  const sessionKeys = secretOrNull(config.SESSION_ENCRYPTION_KEYS);
  const credentialKeys = secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS);
  // Her photo, copied at her import (CRM-07 a2b): to the media bucket, re-encoded by ffmpeg as the drops are.
  const bucket = mediaBucket(config);
  const store = deps.avatars?.store ?? (bucket === null ? null : createS3AvatarStore(bucket));
  const media = createFfmpegMediaTools();
  const module = createConnectorsModule({
    db,
    adminDb,
    ingest: deps.ingest,
    registry: deps.registry,
    sessionKeys: sessionKeys === null ? null : parseEncryptionKeys(sessionKeys, 'SESSION_ENCRYPTION_KEYS'),
    deviceToken: secretOrNull(config.EXTENSION_DEVICE_TOKEN),
    // The AI keys' encryption (ADR 0050 § 4): without it no sales feed key is kept, nothing is read.
    credentialKeys:
      credentialKeys === null ? null : parseEncryptionKeys(credentialKeys, 'CREDENTIALS_ENCRYPTION_KEYS'),
    // Nothing is called at Reveal until the owner pastes a key in Réglages.
    // In the recette sandbox (ADR 0075), the same adapter reads the fake world's CRM API.
    salesFeeds: deps.salesFeeds ?? { reveal: revealSalesFeed(fetch, sandboxOf(config)?.baseUrls.revealCrm) },
    // Deliveries come to the address the owner signs in at; over plain HTTP (development) no webhook is registered,
    // except in the recette sandbox (ADR 0075), where the fake world posts them to the API on this machine.
    ...(sandboxOf(config) === null
      ? { publicBaseUrl: config.AUTH_BASE_URL }
      : { publicBaseUrl: `http://127.0.0.1:${String(config.PORT)}`, loopbackWebhooks: true }),
    // The automatic sales check compares the accounts the pay rules put on the platform's net (CRM-04 b3).
    detectedAccounts: (period) => withAdmin(adminDb, (tx) => salesCheckReads.detectedAccounts(tx, period)),
    // Reveal's register down or back (Telegram P3-12), told by the Telegram module.
    publishConnectionState: createConnectionStatePublisher(adminDb, deps.now),
    avatars:
      store === null
        ? null
        : {
            fetch: deps.avatars?.fetch ?? createAvatarFetch(),
            sniff: sniffMediaType,
            toJpeg: (image) => media.toJpeg(image),
            store,
          },
    ...(deps.now !== undefined && { clock: { now: deps.now } }),
  });
  return {
    module,
    tasks: {
      'connector.dispatch': defineTask(
        'connector.dispatch',
        JOB_PAYLOADS['connector.dispatch'],
        logger,
        (_payload, context) => module.jobs.dispatch(context.logger),
      ),
      'connector.poll': defineTask(
        'connector.poll',
        JOB_PAYLOADS['connector.poll'],
        logger,
        (payload, context) => module.jobs.poll(payload, context.logger),
      ),
      'connector.reconcile': defineTask(
        'connector.reconcile',
        JOB_PAYLOADS['connector.reconcile'],
        logger,
        (payload, context) => module.jobs.reconcile(payload, context.logger),
      ),
      'connector.read_sales': defineTask(
        'connector.read_sales',
        JOB_PAYLOADS['connector.read_sales'],
        logger,
        (payload, context) =>
          module.jobs.readSales(context.logger, `job:${context.jobId}`, payload.woken === true),
      ),
      'connector.check_sales': defineTask(
        'connector.check_sales',
        JOB_PAYLOADS['connector.check_sales'],
        logger,
        (payload, context) => module.jobs.checkSales(payload, context.logger, `job:${context.jobId}`),
      ),
      'connector.read_daily_stats': defineTask(
        'connector.read_daily_stats',
        JOB_PAYLOADS['connector.read_daily_stats'],
        logger,
        (_payload, context) => module.jobs.readDailyStats(context.logger, `job:${context.jobId}`),
      ),
      'connector.copy_avatar': defineTask(
        'connector.copy_avatar',
        JOB_PAYLOADS['connector.copy_avatar'],
        logger,
        (payload, context) => module.jobs.copyAvatar(payload, context.logger),
      ),
    },
    routes: [
      module.routes,
      module.salesFeedRoutes({ guard: requireRole('owner'), recentLogin }),
      module.salesFeedTeamRoutes({
        guard: requireRole('owner', 'operator'),
        recentLogin,
        invite: deps.invite,
      }),
      module.salesFeedDeliveryRoutes,
      module.avatarRoutes(requireRole('owner', 'operator', 'creator')),
    ],
  };
}
