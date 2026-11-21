import { describe, expect, it } from 'vitest';

import { planWeeks, type PlanWeeksDeps } from '../plan-weeks';

/* Two invented creators, Sunday 22 November at 19 h 30 in Paris: both weeks are due. */
const SUNDAY_EVENING = new Date('2026-11-22T18:30:00.000Z');
const creators = [
  { creatorId: '0192f3a0-0000-7000-8000-0000000000c1', timeZone: 'Europe/Paris' },
  { creatorId: '0192f3a0-0000-7000-8000-0000000000c2', timeZone: 'Europe/Paris' },
];

function deps(unreadable: ReadonlySet<string>): PlanWeeksDeps {
  return {
    drafts: {
      creators: () => Promise.resolve(creators),
      saveDraft: () => Promise.resolve('written'),
    },
    facts: {
      facts: (creatorId) =>
        unreadable.has(creatorId)
          ? Promise.reject(new Error('stock unreadable'))
          : Promise.resolve({
              stock: { sessions: 0, videos: 0, stories: 0 },
              scripts: [],
              lastScriptAt: null,
            }),
      shootDaysOf: () => Promise.resolve([]),
      dispoMinutes: () => Promise.resolve(new Map<number, number>()),
    },
  };
}

describe('the hourly job of her week', () => {
  it('goes on past one creator whose figures cannot be read', async () => {
    const run = await planWeeks(deps(new Set([creators[0]?.creatorId ?? ''])), SUNDAY_EVENING);
    expect(run).toEqual({ outcomes: { written: 1 }, failed: [creators[0]?.creatorId] });
  });

  it('throws when every creator failed, so that the worker logs and retries it', async () => {
    await expect(
      planWeeks(deps(new Set(creators.map((creator) => creator.creatorId))), SUNDAY_EVENING),
    ).rejects.toThrow('stock unreadable');
  });
});
