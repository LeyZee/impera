/** Public entry point of the `notifications` module (CR-01, ADR 0042 § 7). Other modules import this file only. */
import type { PushMessage, PushTestResult } from '@nirvana/contracts';
import type { Database, EncryptionKey } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { deliver, type DevicesDeps } from './application/devices';
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
  /** Delivers to every device of an account now; null when push is off. The rules of when are the caller's. */
  readonly deliver: ((userId: string, message: PushMessage) => Promise<PushTestResult>) | null;
}

export function createNotificationsModule(deps: NotificationsDeps): NotificationsModule {
  const devices: DevicesDeps | null =
    deps.encryptionKeys === null
      ? null
      : {
          keys: createServerKeyStore(deps.adminDb, deps.encryptionKeys),
          subscriptions: createSubscriptionStore(deps.db, deps.adminDb),
          preferences: createPreferencesStore(deps.db),
          sender: createPushSender(deps.webOrigin, deps.fetch),
        };
  return {
    name: 'notifications',
    routes: createNotificationRoutes(devices, deps.requireRole),
    deliver: devices === null ? null : (userId, message) => deliver(devices, userId, message),
  };
}
