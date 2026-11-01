import { newId, ShiftTemplateIdSchema, type ShiftTemplateId } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { PlanningAdmin, PlanningClock } from '../../domain/ports';
import { makeShifts } from '../make-shifts';

const now = new Date('2026-10-27T12:00:00Z');
const [first, faulty, last] = [
  newId(ShiftTemplateIdSchema),
  newId(ShiftTemplateIdSchema),
  newId(ShiftTemplateIdSchema),
];

/** The admin port in memory: three running templates, the second one fails as `failure` says. */
function admin(failure: Error, days: string[] = [], clocks: PlanningClock[] = []): PlanningAdmin {
  return {
    memberShiftsUnscoped: () => Promise.reject(new Error('not used by the job')),
    onShiftUnscoped: () => Promise.reject(new Error('not used by the job')),
    settingsUnscoped: () =>
      Promise.resolve({
        timeZone: 'Pacific/Auckland',
        slotStartMinute: 0,
        slotLengthMinutes: 360,
        accessMarginMinutes: 15,
      }),
    runningTemplatesUnscoped: (today) => {
      days.push(today);
      return Promise.resolve([first, faulty, last]);
    },
    makeTemplateShiftsUnscoped: (id: ShiftTemplateId, clock) => {
      clocks.push(clock);
      return id === faulty ? Promise.reject(failure) : Promise.resolve(id === first ? 2 : 3);
    },
  };
}

function logger() {
  const warned: { object: object; message: string }[] = [];
  return { warned, warn: (object: object, message: string) => warned.push({ object, message }) };
}

describe('makeShifts', () => {
  it('makes the other templates when one fails, and logs the failing one by its id and error name only', async () => {
    const log = logger();
    expect(await makeShifts(admin(new TypeError('row mismatch')), log, now)).toBe(5);
    expect(log.warned).toEqual([
      {
        object: { templateId: faulty, err: 'TypeError' },
        message: 'make_shifts: template failed, tried again next hour',
      },
    ]);
  });

  it("reads today and the clock in the grid's zone", async () => {
    const days: string[] = [];
    const clocks: PlanningClock[] = [];
    await makeShifts(admin(new Error('x'), days, clocks), logger(), now);
    // 12:00 UTC on 27 October is already the 28th in Auckland.
    expect(days).toEqual(['2026-10-28']);
    expect(clocks).toEqual([1, 2, 3].map(() => ({ now, timeZone: 'Pacific/Auckland' })));
  });

  it('fails the job when the running templates cannot be read', async () => {
    const reading = {
      ...admin(new Error('x')),
      runningTemplatesUnscoped: () => Promise.reject(new Error('down')),
    };
    await expect(makeShifts(reading, logger(), now)).rejects.toThrow('down');
  });
});
