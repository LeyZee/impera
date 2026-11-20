import type { AgencyCreatorWeek, WeekPlan } from '@impera/contracts';

import type { WeekAgendaStore, WeekFrames } from '../../creator-tasks';
import { addDays } from '../../scheduling/pure';
import { CreatorWeekPlanInvalid, CreatorWeekValidated } from '../domain/errors';
import { frameId, lineId } from '../domain/ids';
import { daysInWeek } from '../domain/plan';
import type { WeekDraftStore } from '../domain/ports';

export interface ValidateDeps {
  readonly drafts: Pick<WeekDraftStore, 'forValidation' | 'markValidated'>;
  readonly agenda: Pick<WeekAgendaStore, 'suggestWeek'>;
}

/** Her week as it enters her agenda: a frame per shooting day with its lines, and the delivery on her Sunday. */
function framesOf(creatorId: string, week: string, plan: WeekPlan): WeekFrames {
  const sunday = addDays(week, 6);
  return {
    week,
    shootDays: plan.shootDays.map((shootDay) => {
      const id = frameId(creatorId, week, 'shoot_day', shootDay.day);
      return {
        id,
        day: shootDay.day,
        lines: shootDay.items.map((item, position) => ({
          id: lineId(id, position),
          need: item.need,
          label: item.label,
          sheet: item.sheet,
          count: item.count,
          requestId: item.requestId,
        })),
      };
    }),
    delivery: { id: frameId(creatorId, week, 'delivery', sunday), day: sunday },
  };
}

const sameShape = (a: WeekPlan, b: WeekPlan): boolean =>
  JSON.stringify([a.shootDays, a.deferred]) === JSON.stringify([b.shootDays, b.deferred]);

/**
 * The owner validates her week as he corrected it (ADR 0140 § 13): its days and lines; its deadline, its stock and
 * the capacity stay the computed ones. The frames enter her agenda first (replayable), then the week is marked: a
 * failure between the two is mended by the same validation again. Replayed with the same plan, it answers the week.
 */
export async function validateWeek(
  deps: ValidateDeps,
  creatorId: string,
  userId: string,
  week: string,
  corrected: WeekPlan,
  now: Date,
): Promise<AgencyCreatorWeek> {
  const current = await deps.drafts.forValidation(creatorId, userId, week);
  const plan: WeekPlan = {
    ...current.plan,
    shootDays: [...corrected.shootDays].sort((a, b) => a.day.localeCompare(b.day)),
    deferred: corrected.deferred,
  };
  if (current.state === 'validated') {
    if (sameShape(current.plan, plan)) return current;
    throw new CreatorWeekValidated();
  }
  if (
    !daysInWeek(
      week,
      plan.shootDays.map((day) => day.day),
    )
  )
    throw new CreatorWeekPlanInvalid();
  await deps.agenda.suggestWeek(creatorId, userId, framesOf(creatorId, week, plan));
  return deps.drafts.markValidated(creatorId, userId, week, plan, now);
}
