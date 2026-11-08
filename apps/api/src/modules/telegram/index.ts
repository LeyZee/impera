/** Public entry point of the `telegram` module (ADR 0002, ADR 0020). Other modules import this file only. */
import type { TelegramBotId, TelegramChatId } from '@impera/contracts';
import { parseEncryptionKeys, type Database, type EncryptionKey } from '@impera/db';
import type { LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { TelegramApi } from './application/api';
import { channelView, saveChannel } from './application/channel';
import { tryChannelPost } from './application/channel-post';
import { connectionReminders } from './application/connections';
import { flushChat, type FlushDeps } from './application/flush';
import { dispatchPolls, pollBot } from './application/poll';
import {
  hasPrivateLink,
  issueLinkCode,
  privateLinkOf,
  sendPrivate,
  type PrivateSendOutcome,
} from './application/private-link';
import { eveningDigest, saleSettings, saveSaleSettings } from './application/sales';
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
  type SettingsDeps,
} from './application/settings';
import { TelegramChannelsUnavailable, TelegramChannelWriterUnavailable } from './domain/errors';
import type {
  AlertNames,
  BotsStore,
  ChannelPersonaSource,
  ChannelsStore,
  Clock,
  DeliveriesStore,
  NotificationChannel,
  PrivateLinksStore,
  SalesDayReader,
  UsdRateReader,
} from './domain/ports';
import type { ScannedEvent } from './domain/signals';
import { channelVoiceOf } from './infra/channel-voice';
import { createPostgresChannelsStore } from './infra/channels.store';
import { createPostgresTelegramStore, type ResealReport } from './infra/postgres.store';
import {
  createPrivateLinkRoutes,
  type PrivateLinkApi,
  type PrivateLinkRoutesOptions,
} from './infra/private-link-routes';
import { createPostgresPrivateLinksStore } from './infra/private-links.store';
import { createTelegramRoutes, type TelegramRoutesOptions } from './infra/routes';
import { createTelegramApi } from './infra/telegram-api';

export { SCANNED_EVENT_TYPES } from './domain/classify';
export type { ChannelPersonaSource } from './domain/ports';

export interface TelegramDeps {
  readonly bots: BotsStore;
  readonly deliveries: DeliveriesStore;
  readonly channel: NotificationChannel;
  /** ADR 0068 § 4: the accounts' private chats; without it, no link is made and `/start` is read past. */
  readonly privateLinks?: PrivateLinksStore;
  /** ADR 0080: the creators' channels; without it, the channel routes answer 503 and the routing checks nothing. */
  readonly channels?: ChannelsStore;
  readonly clock?: Clock;
  /** WEB_ORIGIN: the links of the messages open the CRM. */
  readonly webOrigin: string;
  /** An urgent alert no group can receive (ADR 0020 §12): the caller logs it as an error. */
  readonly onUncovered?: (event: ScannedEvent) => void;
  /** Re-seals the tokens with the newest key at start (rotation); absent in tests. */
  readonly resealTokens?: () => Promise<ResealReport>;
  /** Her alerts' names, to name the alert in its message (P4-01). */
  readonly alertNames?: AlertNames;
  /** Her day's sales (`salesFeedTotals` of `connectors`), for the evening digest; without them, no digest. */
  readonly salesDay?: SalesDayReader;
  /** Pay's dollar rate (`latestRateOf` of `payroll`), for the minimum price of a dollar sale. */
  readonly usdRate?: UsdRateReader;
  /** ADR 0080 § 5: her persona and the voice that write her channel's posts; without them, nothing is written. */
  readonly channelWriter?: ChannelWriter;
}

/** Her persona with her guards (from `agent`) and the gateway's voice, wired by the composition root. */
interface ChannelWriter {
  readonly persona: ChannelPersonaSource;
  readonly gateway: Pick<LlmGateway, 'channelPost'>;
}

/** The job handlers, one per `telegram.*` job (TELEGRAM_JOB_PAYLOADS); the worker wires them. */
interface TelegramJobs {
  scan(): Promise<number>;
  flushChat(chatId: TelegramChatId): Promise<void>;
  dispatchPolls(): Promise<number>;
  pollUpdates(botId: TelegramBotId, waitSeconds: number): Promise<void>;
  morningDigest(): Promise<number>;
  eveningDigest(): Promise<number>;
  connectionReminders(): Promise<number>;
  purge(): Promise<number>;
}

export interface TelegramModule extends TelegramApi {
  readonly name: 'telegram';
  readonly jobs: TelegramJobs;
  /** Re-seals tokens left on an older encryption key; call once at start-up. */
  readonly start: () => Promise<ResealReport>;
  /** `/v1/settings/telegram`, behind the guards given here. */
  readonly routes: (options: TelegramRoutesOptions) => FastifyPluginAsyncZod;
  /** An account's private chat (ADR 0068 § 4): whether it is linked, and the reset link sent there (`auth`). */
  readonly privateChat: PrivateChat;
  /** `/v1/auth/telegram-link` (ADR 0068 § 4), the signed-in account's own private chat. */
  readonly privateLinkRoutes: (options: PrivateLinkRoutesOptions) => FastifyPluginAsyncZod;
}

interface PrivateChat {
  has(userId: string): Promise<boolean>;
  send(userId: string, text: string): Promise<PrivateSendOutcome>;
}

export function createTelegramModule(deps: TelegramDeps): TelegramModule {
  const clock = deps.clock ?? { now: () => new Date() };
  const base: FlushDeps & SettingsDeps = {
    bots: deps.bots,
    deliveries: deps.deliveries,
    channel: deps.channel,
    clock,
    ...(deps.channels !== undefined && { channels: deps.channels }),
  };
  const channels = deps.channels;
  const writer = deps.channelWriter;
  const privateLinks = deps.privateLinks;
  const linking: PrivateLinkApi = {
    issueCode: (userId) =>
      privateLinks === undefined ? Promise.resolve(null) : issueLinkCode({ ...base, privateLinks }, userId),
    linkOf: (userId) =>
      privateLinks === undefined
        ? Promise.resolve({ linked: false, botUsername: null, linkedAt: null })
        : privateLinkOf({ ...base, privateLinks }, userId),
    unlink: async (userId) => {
      await privateLinks?.removeLink(userId);
    },
  };
  const privateChat: PrivateChat = {
    has: (userId) =>
      privateLinks === undefined ? Promise.resolve(false) : hasPrivateLink({ ...base, privateLinks }, userId),
    send: (userId, text) =>
      privateLinks === undefined
        ? Promise.resolve('no_link')
        : sendPrivate({ ...base, privateLinks }, userId, text),
  };
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
    saleSettings: () => saleSettings(base),
    saveSaleSettings: (entries, userId) => saveSaleSettings(base, entries, userId),
    channel: (creatorId) =>
      channels === undefined
        ? Promise.reject(new TelegramChannelsUnavailable())
        : channelView({ bots: deps.bots, channels }, creatorId),
    saveChannel: (creatorId, config, userId) =>
      channels === undefined
        ? Promise.reject(new TelegramChannelsUnavailable())
        : saveChannel({ bots: deps.bots, channels }, creatorId, config, userId),
    tryChannelPost: (creatorId, body) =>
      channels === undefined
        ? Promise.reject(new TelegramChannelsUnavailable())
        : writer === undefined
          ? Promise.reject(new TelegramChannelWriterUnavailable())
          : tryChannelPost(
              { channels, persona: writer.persona, voice: channelVoiceOf(writer.gateway) },
              creatorId,
              body,
            ),
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
          ...(deps.usdRate !== undefined && { usdRate: deps.usdRate }),
        }),
      flushChat: (chatId) => flushChat(base, chatId),
      dispatchPolls: () => dispatchPolls(base),
      pollUpdates: (botId, waitSeconds) =>
        pollBot({ ...base, ...(privateLinks !== undefined && { privateLinks }) }, botId, waitSeconds),
      morningDigest: () => morningDigest(base),
      eveningDigest: () =>
        deps.salesDay === undefined
          ? Promise.resolve(0)
          : eveningDigest({ ...base, salesDay: deps.salesDay }),
      connectionReminders: () => connectionReminders({ ...base, webOrigin: deps.webOrigin }),
      purge: () => purge(base),
    },
    start: () => deps.resealTokens?.() ?? Promise.resolve({ rewritten: 0, unreadable: [] }),
    routes: (options) => createTelegramRoutes(api, options),
    privateChat,
    privateLinkRoutes: (options) => createPrivateLinkRoutes(linking, options),
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
  readonly salesDay: SalesDayReader;
  readonly usdRate: UsdRateReader;
  readonly channelWriter?: ChannelWriter;
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
    privateLinks: createPostgresPrivateLinksStore(options.adminDb),
    channels: createPostgresChannelsStore(options.adminDb),
    channel: createTelegramApi({ fetch }),
    webOrigin: options.webOrigin,
    onUncovered: options.onUncovered,
    resealTokens: store.resealTokens,
    alertNames: options.alertNames,
    salesDay: options.salesDay,
    usdRate: options.usdRate,
    ...(options.channelWriter !== undefined && { channelWriter: options.channelWriter }),
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
