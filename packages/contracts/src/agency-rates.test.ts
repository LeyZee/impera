import { describe, expect, it } from 'vitest';

import {
  AGENCY_RATE_ERROR_CODES,
  agencyRateFor,
  CreateCreatorAgencyRateBodySchema,
  CreatorAgencyRateSchema,
} from './agency-rates';

const body = { id: '0199f2a0-0000-7000-8000-0000000000b1', fromDay: '2026-11-10', agencyBps: 3500 };

const rate = (fromDay: string, agencyBps: number) =>
  CreatorAgencyRateSchema.parse({
    ...body,
    fromDay,
    agencyBps,
    creatorId: '0199f2a0-0000-7000-8000-0000000000c1',
    createdAt: '2026-11-03T10:00:00Z',
  });

describe('the agency’s percentage of a creator (CR-04)', () => {
  it('takes whole basis points from 0 to 10 000 and a calendar day', () => {
    expect(CreateCreatorAgencyRateBodySchema.safeParse(body).success).toBe(true);
    expect(CreateCreatorAgencyRateBodySchema.safeParse({ ...body, agencyBps: 3500.5 }).success).toBe(false);
    expect(CreateCreatorAgencyRateBodySchema.safeParse({ ...body, agencyBps: 10_001 }).success).toBe(false);
    expect(CreateCreatorAgencyRateBodySchema.safeParse({ ...body, agencyBps: -1 }).success).toBe(false);
    expect(
      CreateCreatorAgencyRateBodySchema.safeParse({ ...body, fromDay: '2026-11-10T00:00:00Z' }).success,
    ).toBe(false);
  });

  it('has no default: a body without a percentage is refused', () => {
    expect(CreateCreatorAgencyRateBodySchema.safeParse({ id: body.id, fromDay: body.fromDay }).success).toBe(
      false,
    );
  });

  it('is the one with the latest day at or before, and none before the first', () => {
    const rates = [rate('2026-11-20', 3000), rate('2026-11-03', 3500)];
    const at = (day: string) => agencyRateFor(rates, day)?.agencyBps ?? null;
    expect(at('2026-11-02')).toBeNull();
    expect(at('2026-11-03')).toBe(3500);
    // A change in the middle of a pay period: the sales before keep the old percentage.
    expect(at('2026-11-19')).toBe(3500);
    expect(at('2026-11-20')).toBe(3000);
    expect(at('2027-01-01')).toBe(3000);
  });

  it('gives every error code a suffix that sets its status (api.md)', () => {
    for (const code of AGENCY_RATE_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|forbidden)$/u);
    }
  });
});
