/** Public entry point of the `notifications` module (CR-01, ADR 0042 § 7). Other modules import this file only. */
import type { NotificationOutcome, NotificationRequest } from '@nirvana/contracts';
import type { Database, EncryptionKey } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { notify, recap, type NotifyDeps } from './application/notify';
import { createDeliveryRegistry } from './infra/db/deliveries';
import { createPreferencesStore, createServerKeyStore, createSubscriptionStore } from './infra/db/stores';
import { createNotificationRoutes, type RequireRole } from './infra/http/routes';
import { createPushSender } from './infra/push-sender';

export interface NotificationsDeps {
  /** Application role: devices and settings under RLS, one account at a time. */
  readonly db: Database;
  /** Owner role: the server's key, and moving a device between accounts. */
  readonly adminDb: Database;
  /** CREDENTIALS_ENCRYPTION_KEYS; null leaves push off (503), as for an unconfigured development machine. */
  readonly encryptionKeys: readonly EncryptionKey[] | null;
  /** WEB_ORIGIN: how a push service reaches whoever sends (RFC 8292). */
  readonly webOrigin: string;
  readonly requireRole: RequireRole;
  readonly fetch?: typeof fetch;
}

export interface NotificationsModule {
  readonly name: 'notifications';
  /** Mounted under `/v1` by the server: `/notifications/*`. */
  readonly routes: FastifyPluginAsyncZod;
  /**
   * Asks for a notification to an account: once per reason and object, under its quiet hours and its daily cap; null
   * when push is off. EQ-12, CR-04 and CR-13 call it from their jobs.
   */
  readonly notify: ((request: NotificationRequest, at: Date) => Promise<NotificationOutcome>) | null;
  /** The task of `notifications.recap`; null when push is off (the held ones then wait, nothing rings). */
  readonly recap: ((userId: string, at: Date) => Promise<number>) | null;
}

export function createNotificationsModule(deps: NotificationsDeps): NotificationsModule {
  const devices: NotifyDeps | null =
    deps.encryptionKeys === null
      ? null
      : {
          keys: createServerKeyStore(deps.adminDb, deps.encryptionKeys),
          subscriptions: createSubscriptionStore(deps.db, deps.adminDb),
          preferences: createPreferencesStore(deps.db),
          sender: createPushSender(deps.webOrigin, deps.fetch),
          registry: createDeliveryRegistry(deps.db),
        };
  return {
    name: 'notifications',
    routes: createNotificationRoutes(devices, deps.requireRole),
    notify: devices === null ? null : (request, at) => notify(devices, request, at),
    recap: devices === null ? null : (userId, at) => recap(devices, userId, at),
  };
}
