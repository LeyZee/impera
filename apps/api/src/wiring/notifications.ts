import { parseEncryptionKeys } from '@nirvana/db';

import { secretOrNull } from '../config';
import { createNotificationsModule, type NotificationsModule } from '../modules/notifications';

import type { Routes, Shared } from './shared';

export interface WiredNotifications {
  readonly module: NotificationsModule;
  readonly routes: readonly Routes[];
}

/** Push notifications (CR-01): off, with a 503, while CREDENTIALS_ENCRYPTION_KEYS is unset. */
export function wireNotifications(shared: Shared): WiredNotifications {
  const keys = secretOrNull(shared.config.CREDENTIALS_ENCRYPTION_KEYS);
  const module = createNotificationsModule({
    db: shared.db,
    adminDb: shared.adminDb,
    encryptionKeys: keys === null ? null : parseEncryptionKeys(keys, 'CREDENTIALS_ENCRYPTION_KEYS'),
    webOrigin: shared.config.WEB_ORIGIN,
    requireRole: shared.requireRole,
  });
  return { module, routes: [module.routes] };
}
