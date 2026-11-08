import {
  DEFAULT_TELEGRAM_CHANNEL_CONFIG,
  err,
  ok,
  type ChannelRefusal,
  type CreatorId,
  type Result,
  type TelegramChannelConfig,
  type TelegramChannelView,
  type TelegramChatId,
} from '@impera/contracts';

import {
  channelChoices,
  channelRefusal,
  channelWarnings,
  normalizedConfig,
  type ChannelContext,
} from '../domain/channel';
import type { BotsStore, ChannelsStore } from '../domain/ports';

/** Réglages › Créatrices › Canal Telegram (ADR 0080 § 6): her channel, her slots, her redirect links. */

export interface ChannelDeps {
  readonly bots: BotsStore;
  readonly channels: ChannelsStore;
}

async function contextFor(deps: ChannelDeps, creatorId: CreatorId): Promise<ChannelContext> {
  const [chats, { routes }, all] = await Promise.all([
    deps.bots.listChats(),
    deps.bots.listRoutes(),
    deps.channels.listChannels(),
  ]);
  const takenByOthers = new Set<TelegramChatId>();
  for (const record of all) {
    if (record.creatorId !== creatorId && !record.archived && record.chatId !== null)
      takenByOthers.add(record.chatId);
  }
  return { chats, takenByOthers, routed: new Set(routes.map((route) => route.chatId)) };
}

/** Her setting as the screen shows it, the defaults until the owner saved one; null when she is not (or archived). */
export async function channelView(
  deps: ChannelDeps,
  creatorId: CreatorId,
): Promise<TelegramChannelView | null> {
  if (!(await deps.channels.creatorActive(creatorId))) return null;
  const [record, context, bots] = await Promise.all([
    deps.channels.findChannel(creatorId),
    contextFor(deps, creatorId),
    deps.bots.listBots(),
  ]);
  const config = record?.config ?? DEFAULT_TELEGRAM_CHANNEL_CONFIG;
  const hasUsableBot = bots.some((bot) => bot.token !== null && bot.state !== 'refused');
  return {
    creatorId,
    config,
    saved: record !== null && record.config !== null,
    channels: channelChoices(context),
    warnings: channelWarnings(config, context.chats, hasUsableBot),
  };
}

/** Stores her setting whole; the first thing that keeps it out refuses it whole. Null when she is not. */
export async function saveChannel(
  deps: ChannelDeps,
  creatorId: CreatorId,
  config: TelegramChannelConfig,
  userId: string,
): Promise<Result<TelegramChannelView, ChannelRefusal> | null> {
  if (!(await deps.channels.creatorActive(creatorId))) return null;
  const stored = normalizedConfig(config);
  const refusal = channelRefusal(stored, await contextFor(deps, creatorId));
  if (refusal !== null) return err(refusal);
  if ((await deps.channels.saveChannel(creatorId, stored, userId)) === 'chat_taken') {
    return err({ kind: 'chat_taken', message: 'Ce canal vient d’être choisi pour une autre créatrice.' });
  }
  const view = await channelView(deps, creatorId);
  return view === null ? null : ok(view);
}

/** The chats chosen as some creator's channel: alerts never go there (ADR 0080 § 6.1). */
export async function creatorChannelChats(channels: ChannelsStore): Promise<ReadonlySet<TelegramChatId>> {
  const all = await channels.listChannels();
  return new Set(all.flatMap((record) => (record.chatId === null ? [] : [record.chatId])));
}
