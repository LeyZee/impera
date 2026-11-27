/**
 * Public entry point of the `telegram` module (ADR 0002, ADR 0080). Other modules import this file only. Since the
 * 27/11/2026, Telegram serves the creators' channels only: the bots that post there and the channels they find. The
 * agency's alerts, digests and private chats left for the Impera notifications (`alerts` module).
 */
import type { TelegramBotId } from '@impera/contracts';
import { parseEncryptionKeys, type Database, type EncryptionKey } from '@impera/db';
import type { LlmGateway } from '@impera/llm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import type { TelegramApi } from './application/api';
import { channelView, saveChannel } from './application/channel';
import { tryChannelPost } from './application/channel-post';
import { dispatchPolls, pollBot } from './application/poll';
import {
  addBot,
  listen,
  overview,
  removeBot,
  removeChat,
  replaceToken,
  type SettingsDeps,
} from './application/settings';
import { TelegramChannelsUnavailable, TelegramChannelWriterUnavailable } from './domain/errors';
import type {
  BotChannel,
  BotsStore,
  ChannelLinksSource,
  ChannelPersonaSource,
  ChannelsStore,
} from './domain/ports';
import { channelVoiceOf } from './infra/channel-voice';
import { createPostgresChannelsStore } from './infra/channels.store';
import { createPostgresTelegramStore, type ResealReport } from './infra/postgres.store';
import { createTelegramRoutes, type TelegramRoutesOptions } from './infra/routes';
import { createTelegramApi } from './infra/telegram-api';

export type { ChannelLinksSource, ChannelPersonaSource } from './domain/ports';

export interface TelegramDeps {
  readonly bots: BotsStore;
  readonly channel: BotChannel;
  /** ADR 0080: the creators' channels; without it, the channel routes answer 503. */
  readonly channels?: ChannelsStore;
  /** Her redirect links where they are kept since INS-03; without it, the links of the channel's setting are read. */
  readonly channelLinks?: ChannelLinksSource;
  readonly clock?: { now(): Date };
  /** Re-seals the tokens with the newest key at start (rotation); absent in tests. */
  readonly resealTokens?: () => Promise<ResealReport>;
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
  dispatchPolls(): Promise<number>;
  pollUpdates(botId: TelegramBotId, waitSeconds: number): Promise<void>;
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
  const base: SettingsDeps = { bots: deps.bots, channel: deps.channel };
  const channels = deps.channels;
  const links = deps.channelLinks === undefined ? {} : { links: deps.channelLinks };
  const writer = deps.channelWriter;
  const api: TelegramApi = {
    overview: () => overview(base),
    addBot: (token) => addBot(base, token),
    replaceToken: (id, token) => replaceToken(base, id, token),
    removeBot: (id) => removeBot(base, id),
    listen: (id) => listen(base, id),
    removeChat: (id, userId) => removeChat(base, id, userId),
    channel: (creatorId) =>
      channels === undefined
        ? Promise.reject(new TelegramChannelsUnavailable())
        : channelView({ bots: deps.bots, channels, ...links }, creatorId),
    saveChannel: (creatorId, config, userId) =>
      channels === undefined
        ? Promise.reject(new TelegramChannelsUnavailable())
        : saveChannel({ bots: deps.bots, channels, ...links }, creatorId, config, userId),
    tryChannelPost: (creatorId, body) =>
      channels === undefined
        ? Promise.reject(new TelegramChannelsUnavailable())
        : writer === undefined
          ? Promise.reject(new TelegramChannelWriterUnavailable())
          : tryChannelPost(
              { channels, ...links, persona: writer.persona, voice: channelVoiceOf(writer.gateway) },
              creatorId,
              body,
            ),
  };
  return {
    ...api,
    name: 'telegram',
    jobs: {
      dispatchPolls: () => dispatchPolls(base),
      pollUpdates: (botId, waitSeconds) => pollBot({ ...base, clock }, botId, waitSeconds),
    },
    start: () => deps.resealTokens?.() ?? Promise.resolve({ rewritten: 0, unreadable: [] }),
    routes: (options) => createTelegramRoutes(api, options),
  };
}

export interface TelegramStartOptions {
  readonly adminDb: Database;
  /** CREDENTIALS_ENCRYPTION_KEYS: the bot tokens are sealed with the AI service keys' encryption keys. */
  readonly encryptionKeys: string;
  /** Tokens no listed key opens, found at start: the caller logs them (the old key was dropped too early). */
  readonly onUnreadableTokens: (bots: readonly string[]) => void;
  readonly channelWriter?: ChannelWriter;
  readonly channelLinks?: ChannelLinksSource;
}

/** Builds the module on Postgres and the Telegram Bot API, and re-seals the tokens of a past rotation. */
export async function startTelegramModule(options: TelegramStartOptions): Promise<TelegramModule> {
  const store = createPostgresTelegramStore({
    adminDb: options.adminDb,
    keys: parseEncryptionKeys(options.encryptionKeys, 'CREDENTIALS_ENCRYPTION_KEYS'),
  });
  const module = createTelegramModule({
    bots: store.bots,
    channels: createPostgresChannelsStore(options.adminDb),
    channel: createTelegramApi({ fetch }),
    resealTokens: store.resealTokens,
    ...(options.channelWriter !== undefined && { channelWriter: options.channelWriter }),
    ...(options.channelLinks !== undefined && { channelLinks: options.channelLinks }),
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
