import type {
  CreatorId,
  TelegramChatId,
  TelegramCoverage,
  TelegramRoute,
  TelegramTopic,
} from '@impera/contracts';
import { TelegramTopicSchema } from '@impera/contracts';

/**
 * Who is warned (ADR 0020 §12): for each creator, the groups each topic reaches. A route for all creators
 * (`creatorId: null`) counts for each of them; a group the bot left, or where it may not post, reaches nobody.
 */

export interface ReachableChat {
  readonly id: TelegramChatId;
  readonly reachable: boolean;
}

/** The groups a topic of a creator goes to: its own routes plus the routes for every creator, without repeats. */
export function chatsFor(
  routes: readonly TelegramRoute[],
  creatorId: CreatorId | null,
  topic: TelegramTopic,
): readonly TelegramChatId[] {
  const ids = new Set<TelegramChatId>();
  for (const route of routes) {
    if (route.topic !== topic) continue;
    if (route.creatorId === null || route.creatorId === creatorId) ids.add(route.chatId);
  }
  return [...ids];
}

export function computeCoverage(
  creators: readonly { readonly id: CreatorId; readonly displayName: string }[],
  routes: readonly TelegramRoute[],
  chats: readonly ReachableChat[],
): TelegramCoverage {
  const reachable = new Set(chats.filter((chat) => chat.reachable).map((chat) => chat.id));
  return creators.map((creator) => {
    const reaches = (topic: TelegramTopic): boolean =>
      chatsFor(routes, creator.id, topic).some((id) => reachable.has(id));
    return {
      creatorId: creator.id,
      displayName: creator.displayName,
      urgentReachable: reaches('urgent'),
      topicsWithoutGroup: TelegramTopicSchema.options.filter((topic) => !reaches(topic)),
    };
  });
}
