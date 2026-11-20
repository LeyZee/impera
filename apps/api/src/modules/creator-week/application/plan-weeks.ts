import { WeekPlanSchema, type WeekPlan } from '@impera/contracts';

import { addDays } from '../../scheduling/pure';
import {
  WEEK_DEFAULTS,
  chooseShootDays,
  deliveryDue,
  packWeek,
  weekNeeds,
  weekToPlan,
  type WeekSettings,
} from '../domain/plan';
import type { DraftOutcome, WeekDraftStore, WeekFactsReader } from '../domain/ports';

export interface PlanWeeksDeps {
  readonly drafts: Pick<WeekDraftStore, 'creators' | 'saveDraft'>;
  readonly facts: Pick<WeekFactsReader, 'facts' | 'shootDaysOf' | 'dispoMinutes'>;
  readonly settings?: WeekSettings;
}

/** What one run did, for the log: a week per creator whose Sunday 18 h passed, and those that could not be computed. */
export interface PlanWeeksRun {
  readonly outcomes: Readonly<Partial<Record<DraftOutcome, number>>>;
  /** Her week could not be computed (stock unreadable): nothing proposed, never a need made up (ADR 0140 § 19). */
  readonly failed: readonly string[];
}

/** Her week starting `week`, computed by the code on her real figures (ADR 0140 § 2 to § 5). */
async function computeWeek(
  deps: Pick<PlanWeeksDeps, 'facts' | 'settings'>,
  creatorId: string,
  timeZone: string,
  week: string,
): Promise<WeekPlan> {
  const settings = deps.settings ?? WEEK_DEFAULTS;
  const [facts, previous, dispo] = await Promise.all([
    deps.facts.facts(creatorId, addDays(week, 6)),
    deps.facts.shootDaysOf(creatorId, addDays(week, -7)),
    deps.facts.dispoMinutes(creatorId),
  ]);
  const days = chooseShootDays(week, previous, dispo, settings.shootDays);
  const packed = packWeek(weekNeeds(facts, settings), days, settings.capacityMinutes);
  return WeekPlanSchema.parse({
    shootDays: packed.shootDays,
    deferred: packed.deferred,
    dueAt: deliveryDue(week, timeZone, settings).toISOString(),
    stock: facts.stock,
    capacityMinutes: settings.capacityMinutes,
  });
}

/**
 * `creator_week.plan`, each hour (ADR 0140 § 2, § 19): for each creator whose Sunday 18 h has passed, the week after
 * computed as a draft for the owner, refreshed each hour on the stock of now until he validates it. Replayable: one
 * week per creator, a validated week is never touched. One creator that fails does not stop the others; all of them failing
 * throws the last error.
 */
export async function planWeeks(deps: PlanWeeksDeps, now: Date): Promise<PlanWeeksRun> {
  const outcomes: Partial<Record<DraftOutcome, number>> = {};
  const failed: string[] = [];
  let last: unknown = null;
  for (const creator of await deps.drafts.creators()) {
    const week = weekToPlan(now, creator.timeZone);
    if (week === null) continue;
    try {
      const plan = await computeWeek(deps, creator.creatorId, creator.timeZone, week);
      const outcome = await deps.drafts.saveDraft(creator.creatorId, week, plan, now);
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    } catch (error) {
      failed.push(creator.creatorId);
      last = error;
    }
  }
  // Every creator failed: a broken job, not one creator's data; thrown so that the worker logs it and retries.
  if (failed.length > 0 && Object.keys(outcomes).length === 0) throw last;
  return { outcomes, failed };
}
