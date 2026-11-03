import { JOB_PAYLOADS } from '@nirvana/contracts';
import { parseEncryptionKeys } from '@nirvana/db';

import { secretOrNull } from '../config';
import { defineTask } from '../jobs';
import { createNotificationsModule, type NotificationsModule } from '../modules/notifications';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredNotifications {
  readonly module: NotificationsModule;
  readonly tasks: TasksOf<'notifications'>;
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
  return {
    module,
    tasks: {
      'notifications.recap': defineTask(
        'notifications.recap',
        JOB_PAYLOADS['notifications.recap'],
        shared.logger,
        async (payload, context) => {
          if (module.recap === null) {
            context.logger.warn('notifications: push is off, the held notifications stay in the app');
            return;
          }
          context.logger.info(
            { held: await module.recap(payload.userId, new Date()) },
            'notifications: recap',
          );
        },
      ),
      'notifications.creator_sale': defineTask(
        'notifications.creator_sale',
        JOB_PAYLOADS['notifications.creator_sale'],
        shared.logger,
        async (payload, context) => {
          if (module.creatorSale === null) {
            context.logger.warn('notifications: push is off, the sale is not told to her accounts');
            return;
          }
          const outcomes = await module.creatorSale(payload.eventId, new Date());
          context.logger.info({ accounts: outcomes.length, outcomes }, 'notifications: creator sale');
        },
      ),
    },
    routes: [module.routes],
  };
}
