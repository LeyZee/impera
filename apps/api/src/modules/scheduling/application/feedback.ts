import type {
  PutShiftFeedbackBodySchema,
  ShiftFeedback,
  ShiftFeedbackId,
  ShiftFeedbackList,
  ShiftFeedbackQuery,
  ShiftFeedbackRead,
  ShiftId,
  ShiftIncidentStep,
  UserId,
} from '@impera/contracts';
import type { z } from 'zod';

import type { Actor, CreatorDirectory, ShiftFeedbackStore, StoredShiftFeedback } from '../domain/ports';

import { toPlanningAccount, toPlanningMember } from './dto';

/**
 * The mini feedback (ADR 0050 § 10): on an account whose pay reads the platform's sales, the chatter's word at the end
 * of a shift; its incident followed by the agency, « Vu » then « Réglé » (trous béants n° 1). Nothing here touches pay.
 */
export interface ShiftFeedbackService {
  read(actor: UserId, shiftId: ShiftId): Promise<ShiftFeedbackRead>;
  /** `created` is false when the same feedback was already recorded (the route answers 200). */
  put(
    actor: Actor,
    shiftId: ShiftId,
    body: z.output<typeof PutShiftFeedbackBodySchema>,
  ): Promise<{ feedback: ShiftFeedback; created: boolean }>;
  /** Équipe › Rapports: a period's feedbacks, or the incidents still open; one's own for anyone but the agency. */
  list(actor: UserId, query: ShiftFeedbackQuery): Promise<ShiftFeedbackList>;
  /** « Vu » or « Réglé » on an incident. */
  step(actor: Actor, feedbackId: ShiftFeedbackId, step: ShiftIncidentStep): Promise<ShiftFeedback>;
}

const toDto = (feedback: StoredShiftFeedback): ShiftFeedback => ({
  ...feedback,
  signals: [...feedback.signals],
  createdAt: feedback.createdAt.toISOString(),
  incidentSeenAt: feedback.incidentSeenAt?.toISOString() ?? null,
  incidentResolvedAt: feedback.incidentResolvedAt?.toISOString() ?? null,
});

export function createShiftFeedbackService(
  store: ShiftFeedbackStore,
  creators: CreatorDirectory,
  now: () => Date = () => new Date(),
): ShiftFeedbackService {
  return {
    read: async (actor, shiftId) => {
      const feedback = await store.read(actor, shiftId);
      return { feedback: feedback === null ? null : toDto(feedback) };
    },
    put: async (actor, shiftId, body) => {
      const { feedback, created } = await store.create(actor, shiftId, body, now());
      return { feedback: toDto(feedback), created };
    },
    list: async (actor, query) => {
      const listed = await creators.list();
      const read = await store.list(
        actor,
        listed.map((creator) => creator.id),
        query.period ?? null,
      );
      const names = new Map(listed.map((creator) => [creator.id, creator]));
      return {
        feedbacks: read.feedbacks.map((one) => ({
          ...toDto(one),
          shiftStartsAt: one.shiftStartsAt.toISOString(),
          shiftEndsAt: one.shiftEndsAt.toISOString(),
        })),
        accounts: read.accounts.map((account) => toPlanningAccount(account, names)),
        members: read.members.map(toPlanningMember),
      };
    },
    step: async (actor, feedbackId, step) => toDto(await store.step(actor, feedbackId, step)),
  };
}
