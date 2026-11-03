import type {
  PutShiftFeedbackBodySchema,
  ShiftFeedback,
  ShiftFeedbackRead,
  ShiftId,
  UserId,
} from '@nirvana/contracts';
import type { z } from 'zod';

import type { Actor, ShiftFeedbackStore, StoredShiftFeedback } from '../domain/ports';

/**
 * The mini feedback (ADR 0050 § 10): on an account whose pay reads the platform's sales, the chatter's word at the end
 * of a shift. Nothing here touches pay.
 */
export interface ShiftFeedbackService {
  read(actor: UserId, shiftId: ShiftId): Promise<ShiftFeedbackRead>;
  /** `created` is false when the same feedback was already recorded (the route answers 200). */
  put(
    actor: Actor,
    shiftId: ShiftId,
    body: z.output<typeof PutShiftFeedbackBodySchema>,
  ): Promise<{ feedback: ShiftFeedback; created: boolean }>;
}

const toDto = (feedback: StoredShiftFeedback): ShiftFeedback => ({
  ...feedback,
  signals: [...feedback.signals],
  createdAt: feedback.createdAt.toISOString(),
});

export function createShiftFeedbackService(
  store: ShiftFeedbackStore,
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
  };
}
