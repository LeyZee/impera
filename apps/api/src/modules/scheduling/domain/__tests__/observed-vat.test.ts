import { PlatformAccountIdSchema, SalesTotalsRowSchema, type SalesTotalsRow } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { observedVatBps } from '../observed-vat';

const ACCOUNT = '01900000-0000-7000-8000-000000000040';
const OTHER = PlatformAccountIdSchema.parse('01900000-0000-7000-8000-000000000041');

const row = (patch: Partial<SalesTotalsRow>): SalesTotalsRow =>
  SalesTotalsRowSchema.parse({
    day: '2026-11-20',
    platform: 'reveal',
    platformAccountId: ACCOUNT,
    currency: 'EUR',
    saleType: 'ppv',
    seller: { kind: 'none' },
    sales: 1,
    refunds: 0,
    grossInclVatMinor: 12_000,
    grossExclVatMinor: 10_000,
    netMinor: 8_000,
    agencyMinor: 4_000,
    creatorMinor: 4_000,
    ...patch,
  });

describe('the VAT the platform reads on an account (recette PARC-10)', () => {
  it('is what it takes off the price paid, over what is left, on the account’s rows alone', () => {
    expect(
      observedVatBps(
        [
          row({}),
          row({ grossInclVatMinor: 3_000, grossExclVatMinor: 2_500 }),
          row({ platformAccountId: OTHER, grossInclVatMinor: 10_000 }),
        ],
        ACCOUNT,
      ),
    ).toBe(2_000);
  });

  it('says nothing without sales, nor mixes currencies', () => {
    expect(observedVatBps([], ACCOUNT)).toBeNull();
    expect(
      observedVatBps([row({ grossInclVatMinor: 0, grossExclVatMinor: 0, sales: 0 })], ACCOUNT),
    ).toBeNull();
    expect(
      observedVatBps(
        [row({}), row({ currency: 'USD', grossInclVatMinor: 10_000, grossExclVatMinor: 10_000 })],
        ACCOUNT,
      ),
    ).toBe(2_000);
  });
});
