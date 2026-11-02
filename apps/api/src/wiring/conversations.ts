import { JOB_PAYLOADS } from '@nirvana/contracts';

import { defineTask } from '../jobs';
import type { ConnectorsModule } from '../modules/connectors';
import { createConversationsModule, type ConversationsModule } from '../modules/conversations';
import type { FansModule } from '../modules/fans';
import type { PersonaModule } from '../modules/persona';

import type { WiredAgent } from './agent';
import type { WiredAlerts } from './alerts';
import type { WiredMedia } from './media';
import type { Routes, Shared, TasksOf } from './shared';

export interface WiredConversations {
  readonly module: ConversationsModule;
  readonly tasks: TasksOf<'conversation'>;
  readonly routes: readonly Routes[];
}

export function wireConversations(
  shared: Shared,
  deps: {
    readonly fans: FansModule;
    readonly connectors: ConnectorsModule;
    readonly persona: PersonaModule;
    readonly alerts: WiredAlerts['module'];
    readonly agent: WiredAgent;
    readonly media: WiredMedia;
  },
): WiredConversations {
  const { db, adminDb, logger, requireRole, recentLogin } = shared;
  const { agent, persona, alerts } = deps;
  const module = createConversationsModule({
    db,
    adminDb,
    fans: deps.fans,
    sender: deps.connectors.outboundSender,
    requireRole,
    recentLogin,
    voice: agent.activeVoice,
    guard: agent.guard,
    composer: agent.composer,
    ...(agent.followUps !== undefined && { followUps: agent.followUps }),
    replyHours: {
      of: async (creatorId) => {
        const view = await persona.creators.agentHours(creatorId);
        if (view?.invalidStored === true)
          logger.warn({ creatorId }, 'agent hours: stored setting unreadable, defaults used');
        return view === null ? null : { hours: view.hours, timeZone: view.timeZone };
      },
    },
    alertNames: { ofCreator: (creatorId) => alerts.store.names(creatorId) },
    mediaDescriptions: deps.media.descriptions,
  });
  return {
    module,
    tasks: {
      'conversation.respond': defineTask(
        'conversation.respond',
        JOB_PAYLOADS['conversation.respond'],
        logger,
        (payload, context) => module.jobs.respond(payload, context.logger),
      ),
      'conversation.send': defineTask(
        'conversation.send',
        JOB_PAYLOADS['conversation.send'],
        logger,
        (payload, context) => module.jobs.send(payload, context.logger, context.attempt),
      ),
      'conversation.follow_up': defineTask(
        'conversation.follow_up',
        JOB_PAYLOADS['conversation.follow_up'],
        logger,
        (payload, context) => module.jobs.followUp(payload, context.logger),
      ),
      'conversation.record_facts': defineTask(
        'conversation.record_facts',
        JOB_PAYLOADS['conversation.record_facts'],
        logger,
        (payload, context) => module.jobs.recordFacts(payload, context.logger),
      ),
      'conversation.reopen': defineTask(
        'conversation.reopen',
        JOB_PAYLOADS['conversation.reopen'],
        logger,
        (payload, context) => module.jobs.reopen(payload, context.logger),
      ),
      'conversation.release_unavailable': defineTask(
        'conversation.release_unavailable',
        JOB_PAYLOADS['conversation.release_unavailable'],
        logger,
        (_payload, context) => module.jobs.releaseUnavailable(context.logger),
      ),
    },
    routes: [module.routes],
  };
}
