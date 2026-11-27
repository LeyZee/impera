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
  sameLinks,
  type ChannelContext,
} from '../domain/channel';
import type { BotsStore, ChannelLinksSource, ChannelRecord, ChannelsStore } from '../domain/ports';

/** Réglages › Créatrices › Canal Telegram (ADR 0080 § 6): her channel, her slots, her redirect links. */

export interface ChannelDeps {
  readonly bots: BotsStore;
  readonly channels: ChannelsStore;
  /** Her links where they are kept since INS-03; absent, the setting's own links are read. */
  readonly links?: ChannelLinksSource;
}

/**
 * Her setting with her links read where they are kept since INS-03 (ADR 0121 § 1): the links that are on, and the
 * setting's own links only while the other module holds none of hers. The defaults until the owner saved one.
 */
export async function channelConfigOf(
  deps: Pick<ChannelDeps, 'channels' | 'links'>,
  creatorId: CreatorId,
): Promise<{ readonly record: ChannelRecord | null; readonly config: TelegramChannelConfig }> {
  const [record, links] = await Promise.all([
    deps.channels.findChannel(creatorId),
    deps.links === undefined ? null : deps.links(creatorId),
  ]);
  const config = record?.config ?? DEFAULT_TELEGRAM_CHANNEL_CONFIG;
  return { record, config: links === null ? config : { ...config, links: [...links] } };
}

async function contextFor(deps: ChannelDeps, creatorId: CreatorId): Promise<ChannelContext> {
  const [chats, all] = await Promise.all([deps.bots.listChats(), deps.channels.listChannels()]);
  const takenByOthers = new Set<TelegramChatId>();
  for (const record of all) {
    if (record.creatorId !== creatorId && !record.archived && record.chatId !== null)
      takenByOthers.add(record.chatId);
  }
  return { chats, takenByOthers };
}

/** Her setting as the screen shows it, the defaults until the owner saved one; null when she is not (or archived). */
export async function channelView(
  deps: ChannelDeps,
  creatorId: CreatorId,
): Promise<TelegramChannelView | null> {
  if (!(await deps.channels.creatorActive(creatorId))) return null;
  const [{ record, config }, context, bots] = await Promise.all([
    channelConfigOf(deps, creatorId),
    contextFor(deps, creatorId),
    deps.bots.listBots(),
  ]);
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
  // Her links are set in « Liens »: a save that would change them here is refused, never dropped in silence.
  const kept = (await channelConfigOf(deps, creatorId)).config.links;
  if (!sameLinks(kept, config.links)) {
    return err({
      kind: 'links_moved',
      message: 'Ses liens se règlent maintenant dans l’onglet « Liens » de sa fiche : recharge la page.',
    });
  }
  const stored = normalizedConfig({ ...config, links: [...kept] });
  const refusal = channelRefusal(stored, await contextFor(deps, creatorId));
  if (refusal !== null) return err(refusal);
  if ((await deps.channels.saveChannel(creatorId, stored, userId)) === 'chat_taken') {
    return err({ kind: 'chat_taken', message: 'Ce canal vient d’être choisi pour une autre créatrice.' });
  }
  const view = await channelView(deps, creatorId);
  return view === null ? null : ok(view);
}
