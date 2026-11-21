import type { CreatorId, FanId, JobPayload, MessageId, UserId } from '@impera/contracts';
import type { Database } from '@impera/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createConversationCommands, type ConversationCommands } from './application/commands';
import { createAfterSaleJob } from './application/jobs/after-sale';
import { createFollowUpJob } from './application/jobs/follow-up';
import { createReadCardJob } from './application/jobs/read-card';
import { createRecordFactsJob } from './application/jobs/record-facts';
import { createReleaseUnavailableJob } from './application/jobs/release-unavailable';
import { createReopenJob } from './application/jobs/reopen';
import { createRereadCardJob, createRereadCardsJob } from './application/jobs/reread-card';
import { createRespondJob } from './application/jobs/respond';
import { createSendJob } from './application/jobs/send';
import { createConversationReads, type ConversationReads } from './application/reads';
import { cardReadPlan } from './domain/card-read-window';
import type {
  AlertNames,
  BubbleGuard,
  CardReader,
  CardRereadRoom,
  Clock,
  DraftComposer,
  DraftVoice,
  FanDirectory,
  FollowUpPlan,
  JobLogger,
  MediaDescriptions,
  OutboundSender,
  ReplyHours,
  TypingRhythm,
} from './domain/ports';
import { createDrizzleAlertHistory } from './infra/db/alert-history';
import { createDrizzleAwayHolds } from './infra/db/away-holds';
import { createDrizzleCardRereadScan } from './infra/db/card-reread-scan';
import { createDrizzleCopilotReader } from './infra/db/copilot-reader';
import { createDrizzleCreatorSpaceReader } from './infra/db/creator-reader';
import { createDrizzleConversationReader } from './infra/db/reader';
import { createDrizzleUnitOfWork, type CustomOrderStorePort } from './infra/db/unit-of-work';
import { createAlertHistoryRoutes } from './infra/http/alert-history-routes';
import { createCopilotRoutes, type CopilotRouteDeps } from './infra/http/copilot-routes';
import { createCreatorSpaceRoutes } from './infra/http/creator-routes';
import { createConversationRoutes, type RequireRole } from './infra/http/routes';

export { SendRefused } from './domain/errors';
export { cardReadBatches, type CardReadRow } from './domain/card-read-window';
export type {
  BubbleGuard,
  CardReader,
  Clock,
  DraftComposer,
  FollowUpContext,
  FollowUpPlan,
  GuardReadContext,
  OutboundSender,
} from './domain/ports';

/** Public entry point of the `conversations` module (ADR 0002). Other modules import this file only. */
export interface ConversationsModule extends ConversationCommands {
  readonly name: 'conversations';
  /** Mounted under `/v1` by the server. */
  readonly routes: FastifyPluginAsyncZod;
  /**
   * The inbox reads with their access rule (ADR 0026 § 1), bounded by the viewer's creators: what the routes serve, and
   * what an agent access will read through the MCP server, never more than the person it acts for.
   */
  readonly reads: ConversationReads;
  /**
   * Whether that account holds a conversation of this fan, routed to it or taken over by it (ADR 0024, ADR 0025): the
   * `fans` routes let the member who holds it read the fan's limits and what is left to learn, never write them
   * (recette 05/11 CHAT-03).
   */
  isFanHeldBy(creatorId: CreatorId, fanId: FanId, userId: UserId): Promise<boolean>;
  /**
   * A chatter's read of a fan's sheet on its own, in the audit log with the opening of the fan's conversation (ADR
   * 0025): the `fans` routes call it before they read for anyone who does not read the whole creator.
   */
  traceFanOpening(
    creatorId: CreatorId,
    fanId: FanId,
    trace: { readonly userId: UserId; readonly ip: string; readonly via: 'flags' | 'kyc' | 'card' },
  ): Promise<void>;
  /**
   * The text of those of these messages the fan sent (ADR 0085 § 5): the `fans` routes quote the sentence a value of
   * his card was read in. Read under her tenant; anything else is left out.
   */
  fanMessageTexts(
    creatorId: CreatorId,
    fanId: FanId,
    messageIds: readonly MessageId[],
  ): Promise<ReadonlyMap<string, string>>;
  /** Handlers of the module's jobs; the composition root registers them with Graphile Worker. */
  readonly jobs: {
    respond(payload: JobPayload<'conversation.respond'>, logger: JobLogger): Promise<void>;
    send(payload: JobPayload<'conversation.send'>, logger: JobLogger, attempt: number): Promise<void>;
    recordFacts(payload: JobPayload<'conversation.record_facts'>, logger: JobLogger): Promise<void>;
    /** `fans.read_card` (ADR 0085 § 7): his new messages read for his card, whoever answers him. */
    readCard(payload: JobPayload<'fans.read_card'>, logger: JobLogger): Promise<void>;
    /** `fans.reread_cards`, each week (amendement du 21/11): the active conversations' re-read enqueued. */
    rereadCards(payload: JobPayload<'fans.reread_cards'>, logger: JobLogger): Promise<void>;
    /** `fans.reread_card`: a batch of one conversation's weekly re-read, within the day's room. */
    rereadCard(payload: JobPayload<'fans.reread_card'>, logger: JobLogger): Promise<void>;
    followUp(payload: JobPayload<'conversation.follow_up'>, logger: JobLogger): Promise<void>;
    /** `conversation.after_sale` (ADR 0156 § 2): a step he bought or a tip wakes his conversation for her word after it. */
    afterSale(payload: JobPayload<'conversation.after_sale'>, logger: JobLogger): Promise<void>;
    reopen(payload: JobPayload<'conversation.reopen'>, logger: JobLogger): Promise<void>;
    /** Each minute: what members who are no longer `active` still held is handed back (EQ-13). */
    releaseUnavailable(logger: JobLogger): Promise<void>;
  };
}

export interface ConversationsDeps {
  /** Application role (RLS). */
  readonly db: Database;
  /** Owner role: read across creators which conversations members who are away still hold (EQ-13). */
  readonly adminDb: Database;
  readonly fans: FanDirectory;
  /** Implemented by the `connectors` module (P0-06). */
  readonly sender: OutboundSender;
  readonly requireRole: RequireRole;
  /** `requireRecentLogin` (ADR 0016): recording a blind test needs a sign-in under 10 minutes. */
  readonly recentLogin: preValidationAsyncHookHandler;
  /** The voice version the server writes with now (prompt and model): what Automatique is proved on (ADR 0019). */
  readonly voice: DraftVoice;
  /** The agent's hard guards (`AgentBubbleGuard`), read again on every approval (revue 09, G5). */
  readonly guard: BubbleGuard;
  /** The engine (agent module's adapter); without it drafts stay empty for the operator to write. */
  readonly composer?: DraftComposer;
  /** His card read in his messages (ADR 0085 § 7, agent module's adapter); without it, the card waits for a chatter. */
  readonly cardReader?: CardReader;
  /**
   * Whether the day's AI spend leaves room for the weekly re-read of the cards (amendement du 21/11); without it,
   * the re-read never spends.
   */
  readonly cardRereadRoom?: CardRereadRoom;
  /**
   * The full reading of the fan cards (`FAN_CARD_FULL_READ`, ADR 0085 § 7, amendement du 21/11): whole history, chained
   * reads, caught-up history, Monday re-read. Absent or false, the reading runs as before and spends nothing more.
   */
  readonly fanCardFullRead?: boolean;
  /** Her follow-up delays (P3-10, agent module's adapter); without it, no follow-up is scheduled. */
  readonly followUps?: FollowUpPlan;
  /** Her typing rhythm between bubbles (agent module's adapter); without it, her bubbles leave one after the other. */
  readonly typing?: TypingRhythm;
  /** Her hours (P3-14, `persona`); without them she is always open and quiet from 23:00 to 9:00, as before. */
  readonly replyHours?: ReplyHours;
  /** Her own alerts' names (P4-01, `alerts` module's adapter); without them the history says « Alerte personnalisée ». */
  readonly alertNames?: AlertNames;
  /** What her media show (SUIVI-26, `media` module's adapter); without it, Suivi shows a media's kind only. */
  readonly mediaDescriptions?: MediaDescriptions;
  /**
   * The copilot panel's doors (ADR 0086): the person an extension link names, every creator the owner's panel looks
   * in, and the read of a conversation none of them holds yet. Without them, `/v1/copilot` is not mounted.
   */
  readonly copilot?: Pick<CopilotRouteDeps, 'linkUser' | 'allCreatorIds' | 'askRead'>;
  /**
   * His custom order kept by the `custom-orders` module (ADR 0159 § A.2), in the turn's transactions; without it, the
   * agent answers a custom request as before (ADR 0090 § A).
   */
  readonly customOrders?: CustomOrderStorePort;
  readonly clock?: Clock;
}

const noAlertNames: AlertNames = { ofCreator: () => Promise.resolve(new Map()) };

const noMediaDescriptions: MediaDescriptions = { of: () => Promise.resolve(new Map()) };

const systemClock: Clock = { now: () => new Date() };

export function createConversationsModule(deps: ConversationsDeps): ConversationsModule {
  const uow = createDrizzleUnitOfWork(deps.db, {
    ...(deps.customOrders !== undefined && { customOrders: deps.customOrders }),
  });
  const clock = deps.clock ?? systemClock;
  const cardRead = cardReadPlan(deps.fanCardFullRead === true);
  const commands = createConversationCommands({
    uow,
    clock,
    fans: deps.fans,
    voice: deps.voice,
    guard: deps.guard,
    cardRead,
  });
  const reader = createDrizzleConversationReader(
    deps.db,
    clock,
    deps.mediaDescriptions ?? noMediaDescriptions,
  );
  return {
    name: 'conversations',
    ...commands,
    reads: createConversationReads(reader),
    isFanHeldBy: (creatorId, fanId, userId) => reader.isFanHeldBy(creatorId, fanId, userId),
    traceFanOpening: (creatorId, fanId, trace) => reader.traceFanOpening(creatorId, fanId, trace),
    fanMessageTexts: (creatorId, fanId, messageIds) => reader.fanMessageTexts(creatorId, fanId, messageIds),
    routes: async (app, options) => {
      await createConversationRoutes(reader, commands, {
        requireRole: deps.requireRole,
        recentLogin: deps.recentLogin,
      })(app, options);
      await createAlertHistoryRoutes(
        createDrizzleAlertHistory(deps.db),
        deps.alertNames ?? noAlertNames,
        deps.requireRole,
      )(app, options);
      if (deps.copilot !== undefined)
        await createCopilotRoutes({
          ...deps.copilot,
          reader: createDrizzleCopilotReader(deps.db),
          gestures: { uow, clock, commands },
          requireRole: deps.requireRole,
        })(app, options);
      await createCreatorSpaceRoutes(
        createDrizzleCreatorSpaceReader(deps.db, deps.mediaDescriptions ?? noMediaDescriptions),
        deps.requireRole,
        clock,
      )(app, options);
    },
    jobs: {
      respond: createRespondJob({
        uow,
        clock,
        voice: deps.voice,
        fans: deps.fans,
        ...(deps.composer === undefined ? {} : { composer: deps.composer }),
        ...(deps.replyHours === undefined ? {} : { replyHours: deps.replyHours }),
      }),
      send: createSendJob({
        uow,
        clock,
        sender: deps.sender,
        ...(deps.followUps === undefined ? {} : { followUps: deps.followUps }),
        ...(deps.typing === undefined ? {} : { typing: deps.typing }),
      }),
      recordFacts: createRecordFactsJob({ uow, clock, fans: deps.fans }),
      readCard:
        deps.cardReader === undefined
          ? (_payload, logger) => {
              logger.info({}, 'read_card: no reader, the card waits for a chatter');
              return Promise.resolve();
            }
          : createReadCardJob({ uow, clock, fans: deps.fans, reader: deps.cardReader, plan: cardRead }),
      rereadCards: createRereadCardsJob({
        uow,
        clock,
        scan: createDrizzleCardRereadScan(deps.adminDb),
        weekly: cardRead.weekly,
      }),
      rereadCard:
        deps.cardReader === undefined
          ? (_payload, logger) => {
              logger.info({}, 'reread_card: no reader');
              return Promise.resolve();
            }
          : createRereadCardJob({
              uow,
              clock,
              fans: deps.fans,
              reader: deps.cardReader,
              room: deps.cardRereadRoom ?? (() => false),
              weekly: cardRead.weekly,
            }),
      followUp: createFollowUpJob({
        uow,
        clock,
        fans: deps.fans,
        ...(deps.composer === undefined ? {} : { composer: deps.composer }),
        ...(deps.followUps === undefined ? {} : { followUps: deps.followUps }),
        ...(deps.replyHours === undefined ? {} : { replyHours: deps.replyHours }),
      }),
      afterSale: createAfterSaleJob({
        uow,
        clock,
        fans: deps.fans,
        ...(deps.composer === undefined ? {} : { composer: deps.composer }),
        ...(deps.replyHours === undefined ? {} : { replyHours: deps.replyHours }),
      }),
      reopen: createReopenJob({ uow, clock }),
      releaseUnavailable: createReleaseUnavailableJob({
        uow,
        clock,
        holds: createDrizzleAwayHolds(deps.adminDb),
      }),
    },
  };
}
