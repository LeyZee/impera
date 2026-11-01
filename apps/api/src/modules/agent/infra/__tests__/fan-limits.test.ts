import { CreatorIdSchema, FanIdSchema, newId, type FanFlags } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { protectionFor } from '../../domain/hold';
import { createFanLimits } from '../fan-limits';

describe('createFanLimits, a freeze for money', () => {
  it('decides under the row lock, never from a reading a human may have changed since', async () => {
    // His row as the lock sees it: a human froze him from Suivi after any earlier reading of his limits.
    let row: FanFlags = { salesFrozen: { reason: 'operator', since: '2026-10-17T19:59:00.000Z' } };
    const writes: string[] = [];
    const limits = createFanLimits({
      flags: () => Promise.resolve({}),
      setFlag: () => Promise.reject(new Error('an unconditional write would overwrite his freeze')),
      setFlagIfUnset: (_creator, _fan, change) => {
        writes.push(change.flag);
        if (change.flag === 'salesFrozen' && row.salesFrozen === undefined)
          row = { salesFrozen: change.value };
        return Promise.resolve(row);
      },
      clearFlag: () => Promise.reject(new Error('not used')),
      confirmDeclaredAge: () => Promise.reject(new Error('not used')),
    });
    await limits.protect(
      newId(CreatorIdSchema),
      newId(FanIdSchema),
      protectionFor(['money_trouble']),
      'correlation-1',
      new Date('2026-10-17T20:00:00.000Z'),
    );
    expect(writes).toEqual(['salesFrozen']);
    expect(row.salesFrozen?.reason).toBe('operator');
  });
});
