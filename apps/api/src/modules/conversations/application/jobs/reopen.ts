import { jobKeyFor, queueNameFor, resumeRunAt, type JobPayload } from '@nirvana/contracts';

import type { Clock, JobLogger, UnitOfWork } from '../../domain/ports';

export interface ReopenDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
}

/**
 * `conversation.reopen` (P3-14): her reply slot opened, and every fan who wrote while she was out of her hours
 * is answered, as after a stop: the longest wait first, then one every `RESUME_SPACING_SECONDS`. Each answer is a
 * `conversation.respond` that reads her hours again: if they changed meanwhile, it puts itself off once more. A replay
 * finds the same jobs (their keys), so a fan is never answered twice.
 */
export function createReopenJob({ uow, clock }: ReopenDeps) {
  return async (payload: JobPayload<'conversation.reopen'>, logger: JobLogger): Promise<void> => {
    const now = clock.now();
    const waiting = await uow.inTenant(payload.creatorId, async (tx) => {
      const ids = await tx.conversations.idsInState('pending');
      for (const [index, id] of ids.entries()) {
        await tx.jobs.enqueue(
          'conversation.respond',
          { creatorId: payload.creatorId, conversationId: id, correlationId: payload.correlationId },
          {
            queueName: queueNameFor(id),
            jobKey: jobKeyFor('conversation.respond', id),
            runAt: resumeRunAt(index, now),
            // A fan who is writing right now keeps his debounce: his answer comes when it ends, not before. A job dead
            // after its attempts takes this run again (`unsafe_dedupe` would leave him without one).
            jobKeyMode: 'preserve_run_at',
          },
        );
      }
      return ids.length;
    });
    logger.info({ waiting }, 'reopen: the fans who wrote out of her hours are answered');
  };
}
