/** Public entry point of the `telegram` module (ADR 0002, ADR 0020). Other modules import this file only. */
import type { TelegramBotId, TelegramChatId } from '@nirvana/contracts';
import { parseEncryptionKeys, type Database, type EncryptionKey } from '@nirvana/db';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { TelegramApi } from './application/api';
import { flushChat, type FlushDeps } from './application/flush';
import { dispatchPolls, pollBot } from './application/poll';
import { scanEvents } from './application/scan';
import {
  addBot,
  listDeliveries,
  listen,
  morningDigest,
  nightCounts,
  overview,
  purge,
  removeBot,
  removeChat,
  replaceToken,
  saveRoutes,
  sendTest,
} from './application/settings';
import type { AlertNames, BotsStore, Clock, DeliveriesStore, NotificationChannel } from './domain/ports';
import type { ScannedEvent } from './domain/signals';
import { createPostgresTelegramStore, type ResealReport } from './infra/postgres.store';
import { createTelegramRoutes, type TelegramRoutesOptions } from './infra/routes';
import { createTelegramApi } from './infra/telegram-api';

export { SCANNED_EVENT_TYPES } from './domain/classify';

export interface TelegramDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly channel: NotificationChannel;
  readonly clock?: Clock;
  /** WEB_ORIGIN: the links of the messages open the CRM. */
  readonly webOrigin: string;
  /** An urgent alert no group can receive (ADR 0020 §12): the caller logs it as an error. */
  readonly onUncovered?: (event: ScannedEvent) => void;
  /** Re-seals the tokens with the newest key at start (rotation); absent in tests. */
  readonly resealTokens?: () => Promise<ResealReport>;
  /** Her alerts' names, to name the alert in its message (P4-01). */
  readonly alertNames?: AlertNames;
}

/** The job handlers, one per `telegram.*` job (TELEGRAM_JOB_PAYLOADS); the worker wires them. */
interface TelegramJobs {
  scan(): Promise<number>;
  flushChat(chatId: TelegramChatId): Promise<void>;
  dispatchPolls(): Promise<number>;
  pollUpdates(botId: TelegramBotId, waitSeconds: number): Promise<void>;
  morningDigest(): Promise<number>;
  purge(): Promise<number>;
}

export interface TelegramModule extends TelegramApi {
  readonly name: 'telegram';
  readonly jobs: TelegramJobs;
  /** Re-seals tokens left on an older encryption key; call once at start-up. */
  readonly start: () => Promise<ResealReport>;
  /** `/v1/settings/telegram`, behind the guards given here. */
  readonly routes: (options: TelegramRoutesOptions) => FastifyPluginAsyncZod;
}

export function createTelegramModule(deps: TelegramDeps): TelegramModule {
  const clock = deps.clock ?? { now: () => new Date() };
  const base: FlushDeps = { bots: deps.bots, deliveries: deps.deliveries, channel: deps.channel, clock };
  const api: TelegramApi = {
    overview: () => overview(base),
    addBot: (token) => addBot(base, token),
    replaceToken: (id, token) => replaceToken(base, id, token),
    removeBot: (id) => removeBot(base, id),
    listen: (id) => listen(base, id),
    removeChat: (id, userId) => removeChat(base, id, userId),
    saveRoutes: (version, routes) => saveRoutes(base, version, routes),
    sendTest: (chatId) => sendTest(base, chatId),
    listDeliveries: (topic, limit) => listDeliveries(base, topic, limit),
    nightCounts: (creatorId) => nightCounts(base, creatorId),
  };
  return {
    ...api,
    name: 'telegram',
    jobs: {
      scan: () =>
        scanEvents({
          ...base,
          webOrigin: deps.webOrigin,
          onUncovered: deps.onUncovered ?? (() => undefined),
          ...(deps.alertNames !== undefined && { alertNames: deps.alertNames }),
        }),
      flushChat: (chatId) => flushChat(base, chatId),
      dispatchPolls: () => dispatchPolls(base),
      pollUpdates: (botId, waitSeconds) => pollBot(base, botId, waitSeconds),
      morningDigest: () => morningDigest(base),
      purge: () => purge(base),
    },
    start: () => deps.resealTokens?.() ?? Promise.resolve({ rewritten: 0, unreadable: [] }),
    routes: (options) => createTelegramRoutes(api, options),
  };
}

export interface TelegramStartOptions {
  readonly adminDb: Database;
  /** CREDENTIALS_ENCRYPTION_KEYS: the bot tokens are sealed with the AI service keys' encryption keys. */
  readonly encryptionKeys: string;
  readonly webOrigin: string;
  readonly onUncovered: (event: ScannedEvent) => void;
  /** Tokens no listed key opens, found at start: the caller logs them (the old key was dropped too early). */
  readonly onUnreadableTokens: (bots: readonly string[]) => void;
  readonly alertNames: AlertNames;
}

/** Builds the module on Postgres and the Telegram Bot API, and re-seals the tokens of a past rotation. */
export async function startTelegramModule(options: TelegramStartOptions): Promise<TelegramModule> {
  const store = createPostgresTelegramStore({
    adminDb: options.adminDb,
    keys: parseEncryptionKeys(options.encryptionKeys, 'CREDENTIALS_ENCRYPTION_KEYS'),
  });
  const module = createTelegramModule({
    bots: store.bots,
    deliveries: store.deliveries,
    channel: createTelegramApi({ fetch }),
    webOrigin: options.webOrigin,
    onUncovered: options.onUncovered,
    resealTokens: store.resealTokens,
    alertNames: options.alertNames,
  });
  const report = await module.start();
  if (report.unreadable.length > 0) options.onUnreadableTokens(report.unreadable);
  return module;
}

/** `pnpm ops:reencrypt-credentials`: the bot tokens, next to the AI service keys (rotate-secrets.md). */
export function resealTelegramTokens(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<ResealReport> {
  return createPostgresTelegramStore({ adminDb, keys }).resealTokens();
}

/**
 * `pnpm ops:check-keys` (ADR 0028 § 7): how many bot tokens the given keys open, read only, nothing sent to Telegram.
 * The unreadable ones are named by the bot's username, never by a token.
 */
export async function checkTelegramTokens(
  adminDb: Database,
  keys: readonly EncryptionKey[],
): Promise<{ readonly total: number; readonly unreadable: readonly string[] }> {
  const bots = await createPostgresTelegramStore({ adminDb, keys }).bots.listBots();
  return {
    total: bots.length,
    unreadable: bots.filter((bot) => bot.token === null).map((bot) => bot.username),
  };
}
