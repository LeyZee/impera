import { DomainError, type PayPeriodBlock } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { CommissionRateMissing, MissingExchangeRate, PayPeriodOrder } from '../errors';
import { blockFor, blockReasonOf, sameReason } from '../period-blocks';
import { planPeriod } from '../recalculation';

import { member, P1, P2, report, snapshot } from './fixtures';

/** The refusal `planPeriod` throws on `input`, as the job's decision catches it. */
function refusalOf(input: Parameters<typeof planPeriod>[0]): DomainError {
  try {
    planPeriod(input);
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('the period computed');
}

describe('why a period is blocked (recette du 28/10, Équipe G1)', () => {
  it('names every member the period pays without a rate, in one order, not only the first', () => {
    const theo = member({ rate: null });
    const lea = member({ rate: null });
    const iris = member();
    const refusal = refusalOf(
      snapshot({
        members: [theo, lea, iris],
        reports: [report(theo, P2, 1_000), report(lea, P2, 2_000), report(iris, P2, 3_000)],
      }),
    );
    expect(refusal.code).toBe('commission_rate_missing_conflict');
    expect(blockReasonOf(refusal)).toEqual({
      code: 'commission_rate_missing_conflict',
      memberIds: [theo.id, lea.id].sort(),
    });
  });

  it('names the currency without a rate', () => {
    const theo = member();
    const refusal = refusalOf(
      snapshot({ members: [theo], reports: [report(theo, P2, 1_000, { currency: 'USD' })] }),
    );
    expect(blockReasonOf(refusal)).toEqual({ code: 'exchange_rate_missing_conflict', currency: 'USD' });
  });

  it('records nothing for another refusal, and never the euro', () => {
    expect(blockReasonOf(new PayPeriodOrder(P1))).toBeNull();
    expect(blockReasonOf(new MissingExchangeRate('EUR'))).toBeNull();
  });

  it('is the same reason for the same members or currency, whatever the order they came in', () => {
    const [a, b] = [member().id, member().id];
    const one = blockReasonOf(new CommissionRateMissing(a, b));
    const other = blockReasonOf(new CommissionRateMissing(b, a, a));
    if (one === null || other === null) throw new Error('no reason');
    expect(sameReason(one, other)).toBe(true);
    const fewer = blockReasonOf(new CommissionRateMissing(a));
    if (fewer === null) throw new Error('no reason');
    expect(sameReason(one, fewer)).toBe(false);
    expect(sameReason(one, { code: 'exchange_rate_missing_conflict', currency: 'USD' })).toBe(false);
  });

  it('shows a member the block, and only themselves among those without a rate', () => {
    const [theo, lea] = [member().id, member().id];
    const block: PayPeriodBlock = {
      code: 'commission_rate_missing_conflict',
      memberIds: [theo, lea],
      since: '2025-03-20T10:00:00.000Z',
    };
    expect(blockFor(block, { scope: 'owner', memberId: null })).toEqual(block);
    expect(blockFor(block, { scope: 'agency', memberId: theo })).toEqual(block);
    expect(blockFor(block, { scope: 'self', memberId: theo })).toEqual({ ...block, memberIds: [theo] });
    expect(blockFor(block, { scope: 'self', memberId: member().id })).toEqual({ ...block, memberIds: [] });
    expect(blockFor(block, { scope: 'self', memberId: null })).toEqual({ ...block, memberIds: [] });
    const rate: PayPeriodBlock = {
      code: 'exchange_rate_missing_conflict',
      currency: 'USD',
      since: block.since,
    };
    expect(blockFor(rate, { scope: 'self', memberId: theo })).toEqual(rate);
    expect(blockFor(null, { scope: 'owner', memberId: null })).toBeNull();
  });
});
