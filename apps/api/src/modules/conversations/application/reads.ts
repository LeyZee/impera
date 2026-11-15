import {
  CreatorIdSchema,
  UserIdSchema,
  type ConversationDetail,
  type ConversationEventView,
  type ConversationId,
  type ConversationSummary,
  type CreatorId,
  type CurrentUser,
  type DesireCurve,
  type MessageView,
  type UserId,
} from '@impera/contracts';

import { ConversationForbidden, ConversationNotFound, CreatorForbidden } from '../domain/errors';
import type { ConversationReader, Page, PageRequest } from '../domain/ports';

/**
 * Who reads the conversations, bounded by creator ids (ADR 0026 § 1): what a route reads of the signed-in user, and
 * what an agent access will read of the person it acts for. Each list is a set of creators, never a conversation.
 */
export interface ConversationViewer {
  readonly userId: UserId;
  /** Every conversation of these creators, nothing traced: `'all'` for the owner, else the creators he is given. */
  readonly wholeCreators: readonly CreatorId[] | 'all';
  /** Every conversation of these too, each opening traced: a chatter whose access window is open on her (ADR 0025). */
  readonly shiftCreators: readonly CreatorId[];
  /** Only the conversations he holds there, routed to him or taken over (a member in `self`, ADR 0024). */
  readonly routedCreators: readonly CreatorId[];
}

const creatorIdsOf = (ids: readonly string[]): readonly CreatorId[] =>
  ids.map((id) => CreatorIdSchema.parse(id));

/** The viewer a session gives (`request.user`): the owner reads every creator, the others the ones listed on him. */
export function viewerOf(user: CurrentUser): ConversationViewer {
  return {
    userId: UserIdSchema.parse(user.id),
    wholeCreators: user.role === 'owner' ? 'all' : creatorIdsOf(user.creatorIds),
    shiftCreators: creatorIdsOf(user.shiftCreatorIds),
    routedCreators: creatorIdsOf(user.routedCreatorIds),
  };
}

const within = (ids: readonly CreatorId[] | 'all', creatorId: CreatorId): boolean =>
  ids === 'all' || ids.includes(creatorId);

/** Whether he reads every conversation of this creator, nothing traced: the owner, or a creator he is given. */
export function readsWholeCreator(viewer: ConversationViewer, creatorId: CreatorId): boolean {
  return within(viewer.wholeCreators, creatorId);
}

/**
 * Whether he reads and treats every conversation of this creator: the whole creator, or a chatter whose access window
 * is open on her (ADR 0025, EQ-13). Never her mode nor her blind tests: those stay the whole creator's.
 */
function treatsEveryConversation(viewer: ConversationViewer, creatorId: CreatorId): boolean {
  return readsWholeCreator(viewer, creatorId) || viewer.shiftCreators.includes(creatorId);
}

/** Where a read comes from, for the audit line of a chatter's opening (ADR 0025). */
interface ReadOrigin {
  readonly ip: string;
}

/** The reads of the inbox, each with the access rule the routes had (ADR 0026 § 1): the routes and the MCP share them. */
export interface ConversationReads {
  /**
   * Allowed on this conversation: the whole creator, a chatter in his window on her, or (a member in `self`) only a
   * conversation he holds; otherwise 403 `creator_forbidden` or `conversation_forbidden`.
   */
  actorOn(viewer: ConversationViewer, creatorId: CreatorId, conversationId: ConversationId): Promise<UserId>;
  /** Whether the emergency stop holds her messages: whoever lists her conversations reads it (recette CHAT-07). */
  stopped(viewer: ConversationViewer, creatorId: CreatorId): Promise<boolean>;
  /** Her conversations, only those he holds when he does not treat them all. */
  list(
    viewer: ConversationViewer,
    creatorId: CreatorId,
    page: PageRequest,
  ): Promise<Page<ConversationSummary>>;
  get(
    viewer: ConversationViewer,
    creatorId: CreatorId,
    conversationId: ConversationId,
    origin: ReadOrigin,
  ): Promise<ConversationDetail>;
  messages(
    viewer: ConversationViewer,
    creatorId: CreatorId,
    conversationId: ConversationId,
    page: PageRequest,
    origin: ReadOrigin,
  ): Promise<Page<MessageView>>;
  events(
    viewer: ConversationViewer,
    creatorId: CreatorId,
    conversationId: ConversationId,
    page: PageRequest,
    origin: ReadOrigin,
  ): Promise<Page<ConversationEventView>>;
  desire(
    viewer: ConversationViewer,
    creatorId: CreatorId,
    conversationId: ConversationId,
    origin: ReadOrigin,
  ): Promise<DesireCurve>;
}

export function createConversationReads(reader: ConversationReader): ConversationReads {
  const actorOn: ConversationReads['actorOn'] = async (viewer, creatorId, conversationId) => {
    if (treatsEveryConversation(viewer, creatorId)) return viewer.userId;
    if (!viewer.routedCreators.includes(creatorId)) throw new CreatorForbidden();
    if (!(await reader.isHeldBy(creatorId, conversationId, viewer.userId))) throw new ConversationForbidden();
    return viewer.userId;
  };

  /**
   * `actorOn` for a read of the conversation and its fan's sheet: a chatter's is written in the audit log first, never
   * what he read (ADR 0025), and a conversation the creator does not have answers 404 before anything is read.
   */
  const readerOn = async (
    viewer: ConversationViewer,
    creatorId: CreatorId,
    conversationId: ConversationId,
    origin: ReadOrigin,
    via?: 'messages' | 'events' | 'desire',
  ): Promise<UserId> => {
    const userId = await actorOn(viewer, creatorId, conversationId);
    if (readsWholeCreator(viewer, creatorId)) return userId;
    const trace = { userId, ip: origin.ip, ...(via === undefined ? {} : { via }) };
    if (!(await reader.traceOpening(creatorId, conversationId, trace))) throw new ConversationNotFound();
    return userId;
  };

  const found = <T>(value: T | null): T => {
    if (value === null) throw new ConversationNotFound();
    return value;
  };

  return {
    actorOn,
    async stopped(viewer, creatorId) {
      if (!treatsEveryConversation(viewer, creatorId) && !viewer.routedCreators.includes(creatorId)) {
        throw new CreatorForbidden();
      }
      return reader.sendingStopped(creatorId);
    },
    async list(viewer, creatorId, page) {
      const heldOnly = !treatsEveryConversation(viewer, creatorId);
      if (heldOnly && !viewer.routedCreators.includes(creatorId)) throw new CreatorForbidden();
      return reader.list(creatorId, page, { userId: viewer.userId, heldOnly });
    },
    async get(viewer, creatorId, conversationId, origin) {
      const userId = await readerOn(viewer, creatorId, conversationId, origin);
      return found(await reader.get(creatorId, conversationId, userId));
    },
    async messages(viewer, creatorId, conversationId, page, origin) {
      await readerOn(viewer, creatorId, conversationId, origin, 'messages');
      return found(await reader.messages(creatorId, conversationId, page));
    },
    async events(viewer, creatorId, conversationId, page, origin) {
      await readerOn(viewer, creatorId, conversationId, origin, 'events');
      return found(await reader.events(creatorId, conversationId, page));
    },
    async desire(viewer, creatorId, conversationId, origin) {
      await readerOn(viewer, creatorId, conversationId, origin, 'desire');
      return found(await reader.desireCurve(creatorId, conversationId));
    },
  };
}
