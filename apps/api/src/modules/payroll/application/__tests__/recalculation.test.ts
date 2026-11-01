import { PayPeriodSchema, type PayPeriod } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { PayrollJobStore } from '../../domain/ports';
import { createRecalculation } from '../recalculation';

const P1 = PayPeriodSchema.parse('2025-03-01');
const P2 = PayPeriodSchema.parse('2025-03-16');
const P3 = PayPeriodSchema.parse('2025-04-01');

describe('the hour’s recalculation of the open periods (EQ-04)', () => {
  it('computes every period when one breaks, says which one, and fails the run at the end', async () => {
    const seen: PayPeriod[] = [];
    const errors: object[] = [];
    const broken = new Error('a report without its member');
    const store: PayrollJobStore = {
      openPeriodFactsUnscoped: () =>
        Promise.resolve({ current: P3, lastClosed: null, earliestUncounted: P1 }),
      recomputeUnscoped: (period) => {
        seen.push(period);
        return period === P1
          ? Promise.reject(broken)
          : Promise.resolve({ decision: { kind: 'never' }, closed: false, lastClosed: null });
      },
    };
    const logger = { warn: () => undefined, error: (object: object) => void errors.push(object) };
    const run = createRecalculation(store, logger, () => new Date('2025-04-05T00:00:00Z'));

    await expect(run.recalculateOpen()).rejects.toBe(broken);
    expect(seen).toEqual([P1, P2, P3]);
    expect(errors).toEqual([{ period: P1, err: broken }]);
  });
});
