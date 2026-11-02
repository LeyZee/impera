import { describe, expect, it } from 'vitest';

import { das2Beneficiaries } from '../accounting';

describe('the DAS2 of a year (EQ-06)', () => {
  it('declares what each contractor was paid in the calendar year, over 2 400 € only', () => {
    expect(
      das2Beneficiaries(2026, [
        // 2 400 € exactly is not over the threshold; 1 800 € was over the one before 2024 (1 200 €), no longer.
        { contractorId: 'theo', paidOn: '2026-03-02', sentMinor: 240_000 },
        { contractorId: 'ines', paidOn: '2026-05-04', sentMinor: 180_000 },
        { contractorId: 'nora', paidOn: '2025-12-31', sentMinor: 100_000 },
        { contractorId: 'nora', paidOn: '2026-01-15', sentMinor: 120_000 },
        { contractorId: 'nora', paidOn: '2026-12-31', sentMinor: 120_001 },
        { contractorId: 'basile', paidOn: '2027-01-01', sentMinor: 500_000 },
        { contractorId: 'lou', paidOn: '2026-06-30', sentMinor: 250_000 },
      ]),
    ).toEqual([
      { contractorId: 'lou', paidMinor: 250_000 },
      { contractorId: 'nora', paidMinor: 240_001 },
    ]);
    expect(das2Beneficiaries(2026, [])).toEqual([]);
  });
});
