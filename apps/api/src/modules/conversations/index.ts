import type { JobPayload } from '@nirvana/contracts';
import type { Database } from '@nirvana/db';
import type { preValidationAsyncHookHandler } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';

import { createConversationCommands, type ConversationCommands } from './application/commands';
import { createFollowUpJob } from './application/jobs/follow-up';
import { createRecordFactsJob } from './application/jobs/record-facts';
import { createReopenJob } from './application/jobs/reopen';
import { createRespondJob } from './application/jobs/respond';
import { createSendJob } from './application/jobs/send';
import type {
  AlertNames,
  BubbleGuard,
  Clock,
  DraftComposer,
  DraftVoice,
  FanDirectory,
  FollowUpPlan,
  JobLogger,
  MediaDescriptions,
  OutboundSender,
  ReplyHours,
} from './domain/ports';
import { createDrizzleAlertHistory } from './infra/db/alert-history';
import { createDrizzleConversationReader } from './infra/db/reader';
import { createDrizzleUnitOfWork } from './infra/db/unit-of-work';
import { createAlertHistoryRoutes } from './infra/http/alert-history-routes';
import { createConversationRoutes, type RequireRole } from './infra/http/routes';

export { SendRefused } from './domain/errors';
export type {
  BubbleGuard,
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
  /** Handlers of the module's jobs; the composition root registers them with Graphile Worker. */
  readonly jobs: {
    respond(payload: JobPayload<'conversation.respond'>, logger: JobLogger): Promise<void>;
    send(payload: JobPayload<'conversation.send'>, logger: JobLogger, attempt: number): Promise<void>;
    recordFacts(payload: JobPayload<'conversation.record_facts'>, logger: JobLogger): Promise<void>;
    followUp(payload: JobPayload<'conversation.follow_up'>, logger: JobLogger): Promise<void>;
    reopen(payload: JobPayload<'conversation.reopen'>, logger: JobLogger): Promise<void>;
  };
}

export interface ConversationsDeps {
  /** Application role (RLS). */
  readonly db: Database;
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
  /** Her follow-up delays (P3-10, agent module's adapter); without it, no follow-up is scheduled. */
  readonly followUps?: FollowUpPlan;
  /** Her hours (P3-14, `persona`); without them she is always open and quiet from 23:00 to 9:00, as before. */
  readonly replyHours?: ReplyHours;
  /** Her own alerts' names (P4-01, `alerts` module's adapter); without them the history says « Alerte personnalisée ». */
  readonly alertNames?: AlertNames;
  /** What her media show (SUIVI-26, `media` module's adapter); without it, Suivi shows a media's kind only. */
  readonly mediaDescriptions?: MediaDescriptions;
  readonly clock?: Clock;
}

const noAlertNames: AlertNames = { ofCreator: () => Promise.resolve(new Map()) };

const noMediaDescriptions: MediaDescriptions = { of: () => Promise.resolve(new Map()) };

const systemClock: Clock = { now: () => new Date() };

export function createConversationsModule(deps: ConversationsDeps): ConversationsModule {
  const uow = createDrizzleUnitOfWork(deps.db);
  const clock = deps.clock ?? systemClock;
  const commands = createConversationCommands({
    uow,
    clock,
    fans: deps.fans,
    voice: deps.voice,
    guard: deps.guard,
  });
  return {
    name: 'conversations',
    ...commands,
    routes: async (app, options) => {
      await createConversationRoutes(
        createDrizzleConversationReader(deps.db, clock, deps.mediaDescriptions ?? noMediaDescriptions),
        commands,
        {
          requireRole: deps.requireRole,
          recentLogin: deps.recentLogin,
        },
      )(app, options);
      await createAlertHistoryRoutes(
        createDrizzleAlertHistory(deps.db),
        deps.alertNames ?? noAlertNames,
        deps.requireRole,
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
      }),
      recordFacts: createRecordFactsJob({ uow, clock, fans: deps.fans }),
      followUp: createFollowUpJob({
        uow,
        clock,
        fans: deps.fans,
        ...(deps.composer === undefined ? {} : { composer: deps.composer }),
        ...(deps.followUps === undefined ? {} : { followUps: deps.followUps }),
        ...(deps.replyHours === undefined ? {} : { replyHours: deps.replyHours }),
      }),
      reopen: createReopenJob({ uow, clock }),
    },
  };
}
