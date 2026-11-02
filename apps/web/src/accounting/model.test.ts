import { describe, expect, it } from 'vitest';

import { archiveName, das2Years, fiscalYears, missingAccountsText, periodQuery, warningsOf } from './model';

describe('the exports’ words', () => {
  it('offers the fiscal year in progress up to today, and the whole one before it', () => {
    expect(fiscalYears('2026-11-05')).toEqual({
      current: { from: '2026-01-01', to: '2026-11-05' },
      previous: { from: '2025-01-01', to: '2025-12-31' },
    });
    // Closed on the 30th of June: in November, the year in progress began in July.
    expect(fiscalYears('2026-11-05', 6)).toEqual({
      current: { from: '2026-07-01', to: '2026-11-05' },
      previous: { from: '2025-07-01', to: '2026-06-30' },
    });
    // In March, it began the July before.
    expect(fiscalYears('2026-03-10', 6).current.from).toBe('2025-07-01');
    // On its last day, the year in progress is still that one.
    expect(fiscalYears('2026-06-30', 6).current.from).toBe('2025-07-01');
    // A close at the end of February: a leap year's last day before the new year.
    expect(fiscalYears('2028-03-01', 2).previous).toEqual({ from: '2027-03-01', to: '2028-02-29' });
  });

  it('checks a period with the contract’s reasons before anything is sent', () => {
    expect(periodQuery({ from: '2026-01-01', to: '2026-11-05' })).toEqual({
      ok: true,
      query: { from: '2026-01-01', to: '2026-11-05' },
    });
    expect(periodQuery({ from: '2026-11-06', to: '2026-11-05' })).toEqual({
      ok: false,
      reason: 'La fin suit le début.',
    });
    // 731 days at most: a first fiscal year of 24 months on a 29th of February.
    expect(periodQuery({ from: '2027-01-01', to: '2028-12-31' }).ok).toBe(true);
    expect(periodQuery({ from: '2027-01-01', to: '2029-01-01' })).toEqual({
      ok: false,
      reason: 'Deux ans au plus.',
    });
    expect(periodQuery({ from: '', to: '2026-11-05' })).toEqual({
      ok: false,
      reason: 'Les deux jours, le premier et le dernier.',
    });
  });

  it('names the missing accounts in their one order', () => {
    expect(missingAccountsText(['bank'])).toBe('Il manque un compte du journal : banque.');
    expect(missingAccountsText(['expense', 'vatDeductible', 'purchaseJournal'])).toBe(
      'Il manque 3 comptes du journal : commissions (charges), TVA déductible et journal des achats.',
    );
  });

  it('lists each warning of a recap once, in the contract’s order', () => {
    expect(
      warningsOf([
        { warnings: ['vat_charged', 'profile_changed'] },
        { warnings: ['profile_changed'] },
        { warnings: [] },
      ]),
    ).toEqual(['profile_changed', 'vat_charged']);
  });

  it('says a year and a name as the screen shows them', () => {
    expect(das2Years('2026-11-05')).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017]);
    const range = { from: '2026-01-01', to: '2026-11-05' };
    expect(archiveName('attachment; filename="pieces-prestataires_20260101_20261105.zip"', range)).toBe(
      'pieces-prestataires_20260101_20261105.zip',
    );
    expect(archiveName(null, range)).toBe('pieces-prestataires_20260101_20261105.zip');
  });
});
