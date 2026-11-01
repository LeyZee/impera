import type { JobLogger, PlanningAdmin } from '../domain/ports';
import { DEFAULT_SCHEDULING_SETTINGS } from '../domain/shifts';
import { calendarDayIn } from '../domain/time';

/**
 * The job `scheduling.make_shifts`: the shifts every running template makes ahead; how many were new. One
 * transaction per template, so a template that fails makes nothing this hour while the others go on; the next hour
 * tries it again.
 */
export async function makeShifts(admin: PlanningAdmin, logger: JobLogger, now: Date): Promise<number> {
  const clock = {
    now,
    timeZone: ((await admin.settingsUnscoped()) ?? DEFAULT_SCHEDULING_SETTINGS).timeZone,
  };
  let made = 0;
  for (const templateId of await admin.runningTemplatesUnscoped(calendarDayIn(now, clock.timeZone))) {
    try {
      made += await admin.makeTemplateShiftsUnscoped(templateId, clock);
    } catch (error) {
      logger.warn(
        { templateId, err: error instanceof Error ? error.name : 'unknown' },
        'make_shifts: template failed, tried again next hour',
      );
    }
  }
  return made;
}
