import { awayReleaseReason } from '../../domain/away';
import type { AwayHolds, Clock, JobLogger, UnitOfWork } from '../../domain/ports';
import { nextState } from '../../domain/state-machine';
import { appendEvent } from '../journal';

/** Conversations handed back per run: an agency holds far fewer, the next minute takes any rest. */
const RELEASE_BATCH = 200;

export interface ReleaseUnavailableDeps {
  readonly uow: UnitOfWork;
  readonly clock: Clock;
  readonly holds: AwayHolds;
}

/**
 * `conversation.release_unavailable`, each minute (EQ-13, Charles's « oui » of 01/11): a member who is no longer
 * `active` (on leave, sick, travelling, suspended, gone) already reads no conversation (`auth.ts`); what he still held
 * is handed back as a « Rendre la main » without a note, by the system, with the reason that says his status, so that
 * neither the agent nor another member waits on him. Each conversation is its own transaction under its lock, checked
 * again there: one released meanwhile, by hand or by a run alongside, writes nothing. One that cannot be released
 * (not in `human` nor `error`) is left as it is and logged: he cannot read it anyway.
 */
export function createReleaseUnavailableJob({ uow, clock, holds }: ReleaseUnavailableDeps) {
  return async (logger: JobLogger): Promise<void> => {
    let released = 0;
    for (const hold of await holds.list(RELEASE_BATCH)) {
      try {
        const done = await uow.inTenant(hold.creatorId, async (tx) => {
          const conversation = await tx.conversations.lock(hold.conversationId);
          if (conversation === null || !(await tx.conversations.isHeldBy(conversation.id, hold.userId))) {
            return false;
          }
          if (nextState(conversation.state, 'release') === null) {
            logger.warn(
              { conversationId: conversation.id, state: conversation.state },
              'conversation.release_unavailable: held by a member who is away, but not in a state to release',
            );
            return false;
          }
          await appendEvent(
            tx,
            conversation,
            {
              type: 'takeover_ended',
              payload: {
                conversationId: conversation.id,
                userId: hold.userId,
                reason: awayReleaseReason(hold.status),
              },
            },
            { actor: 'system', correlationId: `release_unavailable:${conversation.id}`, at: clock.now() },
          );
          return true;
        });
        if (done) released += 1;
      } catch (error) {
        // One conversation that fails never holds the others back; the next minute takes it again.
        logger.warn(
          { conversationId: hold.conversationId, err: error },
          'conversation.release_unavailable: a conversation failed',
        );
      }
    }
    if (released > 0) logger.info({ released }, 'conversation.release_unavailable: handed back');
  };
}
