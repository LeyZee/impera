import { WeekPlanItemSchema, WeekPlanSchema, type AgencyCreatorWeek, type WeekPlan } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import type { WeekFrames } from '../../../creator-tasks';
import { CreatorWeekValidated } from '../../domain/errors';
import { validateWeek, type ValidateDeps } from '../validate';

/* An invented creator and owner; her week of Monday 23 November. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const OWNER = 'owner-1';
const WEEK = '2026-11-23';
const NOW = new Date('2026-11-22T19:00:00.000Z');
const line = (label: string) =>
  WeekPlanItemSchema.parse({
    need: 'feed_shoot',
    label,
    sheet: null,
    minutes: 45,
    count: 1,
    requestId: null,
  });
const computed = WeekPlanSchema.parse({
  shootDays: [
    { day: '2026-11-25', items: [line('Séance A')] },
    { day: '2026-11-28', items: [line('Séance B')] },
  ],
  deferred: [],
  dueAt: '2026-11-29T22:00:00.000Z',
  stock: { feed: 0, stories: 0 },
  capacityMinutes: 240,
});

/** Her week in memory, and her agenda that fails once when asked. */
function fakes(failsOnce: boolean): { deps: ValidateDeps; written: WeekFrames[] } {
  let row: AgencyCreatorWeek = {
    week: WEEK,
    state: 'draft',
    plan: computed,
    computedAt: '2026-11-22T17:50:00.000Z',
    validatedAt: null,
  };
  const written: WeekFrames[] = [];
  let fail = failsOnce;
  return {
    written,
    deps: {
      drafts: {
        forValidation: () => Promise.resolve(row),
        markValidated: (_c, _u, _w, plan: WeekPlan, now: Date) => {
          if (row.state === 'draft')
            row = { ...row, state: 'validated', plan, validatedAt: now.toISOString() };
          return Promise.resolve(row);
        },
      },
      agenda: {
        suggestWeek: (_c, _u, frames) => {
          if (fail) {
            fail = false;
            return Promise.reject(new Error('network'));
          }
          written.push(frames);
          return Promise.resolve();
        },
      },
    },
  };
}

const moved: WeekPlan = {
  ...computed,
  shootDays: [{ day: '2026-11-26', items: [line('Séance A'), line('Séance B')] }],
};

describe('the owner validates her week', () => {
  it('records the plan first, and the same validation again writes her agenda after a failure', async () => {
    const { deps, written } = fakes(true);
    await expect(validateWeek(deps, CREATOR, OWNER, WEEK, moved, NOW)).rejects.toThrow('network');
    const week = await validateWeek(deps, CREATOR, OWNER, WEEK, moved, NOW);
    expect(week.state).toBe('validated');
    expect(written.map((frames) => frames.shootDays.map((day) => day.day))).toEqual([['2026-11-26']]);
  });

  it('refuses another plan once one is recorded, even after a failure, and writes nothing of it', async () => {
    const { deps, written } = fakes(true);
    await expect(validateWeek(deps, CREATOR, OWNER, WEEK, moved, NOW)).rejects.toThrow('network');
    await expect(validateWeek(deps, CREATOR, OWNER, WEEK, computed, NOW)).rejects.toBeInstanceOf(
      CreatorWeekValidated,
    );
    expect(written).toEqual([]);
  });
});
