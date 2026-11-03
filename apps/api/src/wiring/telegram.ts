import { JOB_PAYLOADS } from '@nirvana/contracts';
import { withAdmin } from '@nirvana/db';

import { secretOrNull } from '../config';
import { defineTask } from '../jobs';
import type { Logger } from '../logger';
import type { AlertsModule } from '../modules/alerts';
import { salesFeedTotals } from '../modules/connectors';
import { startTelegramModule, type TelegramModule } from '../modules/telegram';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredTelegram {
  /** Null without CREDENTIALS_ENCRYPTION_KEYS: a bot token is never kept unsealed (ADR 0020 §5). */
  readonly module: TelegramModule | null;
  readonly tasks: TasksOf<'telegram'>;
  readonly routes: readonly Routes[];
}

export async function wireTelegram(
  shared: Shared,
  deps: { readonly alerts: AlertsModule },
): Promise<WiredTelegram> {
  const { config, adminDb, logger, requireRole, recentLogin } = shared;
  const credentialKeys = secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS);
  const module =
    credentialKeys === null
      ? null
      : await startTelegramModule({
          adminDb,
          encryptionKeys: credentialKeys,
          webOrigin: config.WEB_ORIGIN,
          onUncovered: (event) => {
            logger.error({ eventId: event.id }, 'urgent alert reaches no Telegram group');
          },
          onUnreadableTokens: (bots) => {
            logger.error({ bots }, 'Telegram bot tokens unreadable with CREDENTIALS_ENCRYPTION_KEYS');
          },
          alertNames: {
            ofCreator: async (creatorId) =>
              new Map([...(await deps.alerts.store.names(creatorId))].map(([id, alert]) => [id, alert.name])),
          },
          // The evening digest reads the one rule of the totals (CRM-04), as the admin role: the job sees every creator.
          salesTotals: {
            totalsOf: (creatorId, day) =>
              withAdmin(adminDb, (tx) => salesFeedTotals.totalsOf(tx, { creatorId, from: day, to: day })),
          },
        });
  if (module === null) logger.warn('Telegram notifications off: CREDENTIALS_ENCRYPTION_KEYS is not set');

  /** A Telegram job when the module is off: nothing to do, said once per run. */
  const withTelegram =
    (run: (telegram: TelegramModule) => Promise<unknown>) =>
    async (_payload: unknown, context: { readonly logger: Logger }): Promise<void> => {
      if (module === null) {
        context.logger.info('telegram: off, nothing to do');
        return;
      }
      await run(module);
    };

  return {
    module,
    tasks: {
      'telegram.scan': defineTask(
        'telegram.scan',
        JOB_PAYLOADS['telegram.scan'],
        logger,
        withTelegram((telegram) => telegram.jobs.scan()),
      ),
      'telegram.flush_chat': defineTask(
        'telegram.flush_chat',
        JOB_PAYLOADS['telegram.flush_chat'],
        logger,
        (payload, context) =>
          withTelegram((telegram) => telegram.jobs.flushChat(payload.chatId))(payload, context),
      ),
      'telegram.dispatch_polls': defineTask(
        'telegram.dispatch_polls',
        JOB_PAYLOADS['telegram.dispatch_polls'],
        logger,
        withTelegram((telegram) => telegram.jobs.dispatchPolls()),
      ),
      'telegram.poll_updates': defineTask(
        'telegram.poll_updates',
        JOB_PAYLOADS['telegram.poll_updates'],
        logger,
        (payload, context) =>
          withTelegram((telegram) => telegram.jobs.pollUpdates(payload.botId, payload.waitSeconds))(
            payload,
            context,
          ),
      ),
      'telegram.morning_digest': defineTask(
        'telegram.morning_digest',
        JOB_PAYLOADS['telegram.morning_digest'],
        logger,
        withTelegram((telegram) => telegram.jobs.morningDigest()),
      ),
      'telegram.evening_digest': defineTask(
        'telegram.evening_digest',
        JOB_PAYLOADS['telegram.evening_digest'],
        logger,
        withTelegram((telegram) => telegram.jobs.eveningDigest()),
      ),
      'telegram.purge': defineTask(
        'telegram.purge',
        JOB_PAYLOADS['telegram.purge'],
        logger,
        withTelegram((telegram) => telegram.jobs.purge()),
      ),
    },
    routes: module === null ? [] : [module.routes({ guard: requireRole('owner'), recentLogin })],
  };
}
