import { describe, expect, it } from 'vitest';

import { complainsOfPurchase, NO_SALE_TROUBLE, saleTroubleOutcome } from '../sale-trouble';

const NOW = new Date('2026-11-20T21:00:00Z');
const ago = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe('a sale gone wrong: she answers once, the same trouble again goes to a human (ADR 0156 § 4 and § 7)', () => {
  it('helps him pay herself, then hands over when he is still stuck the same evening', () => {
    expect(saleTroubleOutcome('payment_help', NO_SALE_TROUBLE, NOW)).toEqual({
      kind: 'answer',
      trouble: 'payment_help',
    });
    const helped = { ...NO_SALE_TROUBLE, paymentHelpAt: ago(0.5) };
    expect(saleTroubleOutcome('payment_help', helped, NOW).kind).toBe('handoff');
    // Another evening: a new trouble, she helps again.
    expect(saleTroubleOutcome('payment_help', { ...NO_SALE_TROUBLE, paymentHelpAt: ago(26) }, NOW).kind).toBe(
      'answer',
    );
    // Her help to pay says nothing of a complaint.
    expect(saleTroubleOutcome('purchase_complaint', helped, NOW).kind).toBe('answer');
  });

  it('answers his complaint herself once, then a human within two days', () => {
    const answered = { ...NO_SALE_TROUBLE, complaintAt: ago(20) };
    expect(saleTroubleOutcome('purchase_complaint', answered, NOW).kind).toBe('handoff');
    expect(
      saleTroubleOutcome('purchase_complaint', { ...NO_SALE_TROUBLE, complaintAt: ago(50) }, NOW).kind,
    ).toBe('answer');
  });

  it('reads a purchase complaint only when he bought from her', () => {
    expect(complainsOfPurchase({ intent: 'complaint', risks: [], hasBought: true })).toBe(true);
    expect(complainsOfPurchase({ intent: 'small_talk', risks: ['dispute'], hasBought: true })).toBe(true);
    expect(complainsOfPurchase({ intent: 'complaint', risks: [], hasBought: false })).toBe(false);
    expect(complainsOfPurchase({ intent: 'flirt', risks: [], hasBought: true })).toBe(false);
  });
});
