import { JOB_PAYLOADS, type StoredPersona } from '@impera/contracts';
import type { LlmGateway } from '@impera/llm';

import { secretOrNull } from '../config';
import { defineTask } from '../jobs';
import type { Logger } from '../logger';
import { channelWriterPersona } from '../modules/agent';
import {
  startTelegramModule,
  type ChannelLinksSource,
  type ChannelPersonaSource,
  type TelegramModule,
} from '../modules/telegram';

import type { Routes, Shared, TasksOf } from './shared';

export interface WiredTelegram {
  /** Null without CREDENTIALS_ENCRYPTION_KEYS: a bot token is never kept unsealed (ADR 0020 §5). */
  readonly module: TelegramModule | null;
  readonly tasks: TasksOf<'telegram'>;
  readonly routes: readonly Routes[];
}

/** Her active persona version as the `persona` module stores it (`versions.active`), matched by shape. */
type ActiveVersion = (creatorId: string) => Promise<{
  readonly id: string;
  readonly version: string;
  readonly creatorName: string;
  readonly persona: StoredPersona;
} | null>;

/**
 * Who she is for her channel's posts (ADR 0080 § 5): her active version, with the agent's guards and nothing explicit
 * on a public channel; none without an active version.
 */
function channelPersonaOf(active: ActiveVersion): ChannelPersonaSource {
  return async (creatorId) => {
    const stored = await active(creatorId);
    return stored === null ? null : channelWriterPersona(stored, new Date());
  };
}

export async function wireTelegram(
  shared: Shared,
  deps: {
    /** ADR 0080 § 5: the app's gateway and her active persona write her channel's posts. */
    readonly channelWriter?: {
      readonly gateway: Pick<LlmGateway, 'channelPost'>;
      readonly activePersona: ActiveVersion;
    };
    /** Her redirect links where they are kept since INS-03 (ADR 0121 § 1). */
    readonly channelLinks?: ChannelLinksSource;
  },
): Promise<WiredTelegram> {
  const { config, adminDb, logger, requireRole, recentLogin } = shared;
  const credentialKeys = secretOrNull(config.CREDENTIALS_ENCRYPTION_KEYS);
  const module =
    credentialKeys === null
      ? null
      : await startTelegramModule({
          adminDb,
          ...(deps.channelLinks !== undefined && { channelLinks: deps.channelLinks }),
          encryptionKeys: credentialKeys,
          onUnreadableTokens: (bots) => {
            logger.error({ bots }, 'Telegram bot tokens unreadable with CREDENTIALS_ENCRYPTION_KEYS');
          },
          ...(deps.channelWriter !== undefined && {
            channelWriter: {
              gateway: deps.channelWriter.gateway,
              persona: channelPersonaOf(deps.channelWriter.activePersona),
            },
          }),
        });
  if (module === null) logger.warn('Telegram channels off: CREDENTIALS_ENCRYPTION_KEYS is not set');

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
    },
    routes: module === null ? [] : [module.routes({ guard: requireRole('owner'), recentLogin })],
  };
}
