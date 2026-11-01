import { describe, expect, it } from 'vitest';

import { PayPeriodSchema } from './pay-periods';
import {
  BonusTierSetSchema,
  canonicalExchangeRates,
  carryOverRank,
  CarryOverSchema,
  CollectiveGoalSchema,
  containsIban,
  CreateBonusBodySchema,
  CreateBonusTierSetBodySchema,
  CreateCollectiveGoalBodySchema,
  CreatePayAdjustmentBodySchema,
  CreatePenaltyBodySchema,
  ExchangeRateSchema,
  mayValidateStatement,
  PAY_AMOUNT_MAX_MINOR,
  PAY_PERIOD_BLOCK_CODES,
  PAYMENT_METHODS,
  PAYROLL_ERROR_CODES,
  PayCommissionStatementBodySchema,
  PayPeriodBlockSchema,
  PayPeriodSummarySchema,
  PayrollPeriodSchema,
  PenaltySchema,
  bonusTiersFor,
  collectiveGoalFor,
  nextPayoutMinimum,
  payoutMinimumFor,
  PayoutMinimumSchema,
  PayrollSettingsSchema,
  UpdatePayrollSettingsBodySchema,
  penaltyApplies,
  penaltyCovers,
  positiveCarryRankIn,
} from './payroll';

const MEMBER = '0199f2a0-0000-7000-8000-0000000000b1';
const USER = '0199f2a0-0000-7000-8000-0000000000d1';
const period = (day: string) => PayPeriodSchema.parse(day);

const bonus = {
  id: '0199f2a0-0000-7000-8000-0000000000e1',
  memberId: MEMBER,
  period: '2026-11-01',
  amountMinor: 5_000,
  reason: 'Week-end tenu seule',
};

const penalty = {
  id: '0199f2a0-0000-7000-8000-0000000000f1',
  memberId: MEMBER,
  fromPeriod: '2026-11-01',
  toPeriod: '2026-11-16',
  amount: { kind: 'fixed', amountMinor: 2_000 },
  reason: 'Shift manqué sans prévenir',
};

const tierSet = (id: string, fromPeriod: string, createdAt: string) =>
  BonusTierSetSchema.parse({
    id,
    fromPeriod,
    tiers: [{ thresholdMinor: 100_000, bonusMinor: 5_000, label: 'Bronze' }],
    createdBy: USER,
    createdAt,
  });

describe('pay amounts', () => {
  it('takes integers only, within the slip guard: no float in pay (ADR 0011)', () => {
    expect(CreateBonusBodySchema.safeParse(bonus).success).toBe(true);
    expect(CreateBonusBodySchema.safeParse({ ...bonus, amountMinor: 50.5 }).success).toBe(false);
    expect(CreateBonusBodySchema.safeParse({ ...bonus, amountMinor: 0 }).success).toBe(false);
    expect(CreateBonusBodySchema.safeParse({ ...bonus, amountMinor: PAY_AMOUNT_MAX_MINOR + 1 }).success).toBe(
      false,
    );
    expect(CreateBonusBodySchema.safeParse({ ...bonus, reason: '  ' }).success).toBe(false);
  });

  it('takes an adjustment in either direction, never 0, and leaves its period to the server', () => {
    const adjustment = {
      id: '0199f2a0-0000-7000-8000-0000000000a2',
      memberId: MEMBER,
      reason: 'Remboursement',
    };
    expect(
      CreatePayAdjustmentBodySchema.parse({ ...adjustment, amountMinor: -4_000 }).correctsStatementId,
    ).toBeNull();
    expect(CreatePayAdjustmentBodySchema.safeParse({ ...adjustment, amountMinor: 0 }).success).toBe(false);
    expect(
      'period' in
        CreatePayAdjustmentBodySchema.parse({ ...adjustment, amountMinor: 1, period: '2026-11-01' }),
    ).toBe(false);
  });

  it('reads an exchange rate in whole millionths, for a currency other than the euro', () => {
    const rate = {
      currency: 'USD',
      day: '2026-10-31',
      rateMicros: 920_000,
      source: 'test',
      fetchedAt: '2026-10-31T16:00:00Z',
    };
    expect(ExchangeRateSchema.safeParse(rate).success).toBe(true);
    expect(ExchangeRateSchema.safeParse({ ...rate, rateMicros: 0.92 }).success).toBe(false);
    expect(ExchangeRateSchema.safeParse({ ...rate, currency: 'EUR' }).success).toBe(false);
  });
});

describe('penalties', () => {
  it('take a fixed amount or a percent, over periods in order', () => {
    expect(CreatePenaltyBodySchema.safeParse(penalty).success).toBe(true);
    expect(
      CreatePenaltyBodySchema.safeParse({ ...penalty, amount: { kind: 'percent', bps: 1_000 } }).success,
    ).toBe(true);
    expect(
      CreatePenaltyBodySchema.safeParse({ ...penalty, amount: { kind: 'percent', bps: 0 } }).success,
    ).toBe(false);
    expect(
      CreatePenaltyBodySchema.safeParse({ ...penalty, amount: { kind: 'percent', amountMinor: 10 } }).success,
    ).toBe(false);
    expect(CreatePenaltyBodySchema.safeParse({ ...penalty, toPeriod: '2026-10-16' }).success).toBe(false);
  });

  it('count in each period they cover, until the period a cancellation starts from', () => {
    const made = { ...penalty, createdBy: USER, createdAt: '2026-11-02T10:00:00Z' };
    const running = PenaltySchema.parse({ ...made, cancellation: null });
    expect(penaltyApplies(running, period('2026-10-16'))).toBe(false);
    expect(penaltyApplies(running, period('2026-11-01'))).toBe(true);
    expect(penaltyApplies(running, period('2026-11-16'))).toBe(true);
    expect(penaltyApplies(running, period('2026-12-01'))).toBe(false);

    const cancellation = {
      cancelledAt: '2026-11-20T10:00:00Z',
      cancelledBy: USER,
      cancelledFrom: '2026-11-16',
    };
    const cancelled = PenaltySchema.parse({ ...made, cancellation });
    expect(penaltyApplies(cancelled, period('2026-11-01'))).toBe(true);
    expect(penaltyApplies(cancelled, period('2026-11-16'))).toBe(false);
    // Cancelled or not, it still covers its periods: a list of the period shows it, struck through where it stopped.
    expect(
      ['2026-10-16', '2026-11-01', '2026-11-16', '2026-12-01'].map((p) =>
        penaltyCovers(cancelled, period(p)),
      ),
    ).toEqual([false, true, true, false]);
  });
});

describe('tiers and goals', () => {
  it('refuse two tiers on the same step, so that their order never matters, and a tier at 0', () => {
    const tiers = [
      { thresholdMinor: 100_000, bonusMinor: 5_000, label: 'Bronze' },
      { thresholdMinor: 100_000, bonusMinor: 8_000, label: 'Argent' },
    ];
    expect(
      CreateBonusTierSetBodySchema.safeParse({ id: USER, fromPeriod: '2026-11-01', tiers }).success,
    ).toBe(false);
    const atZero = [{ thresholdMinor: 0, bonusMinor: 5_000, label: 'Départ' }];
    expect(
      CreateBonusTierSetBodySchema.safeParse({ id: USER, fromPeriod: '2026-11-01', tiers: atZero }).success,
    ).toBe(false);
    const goal = { id: USER, period: '2026-11-01', targetMinor: 1_000_000 };
    const twice = [
      { reachedBps: 10_000, bonusMinor: 3_000 },
      { reachedBps: 10_000, bonusMinor: 5_000 },
    ];
    expect(CreateCollectiveGoalBodySchema.safeParse({ ...goal, tiers: twice }).success).toBe(false);
    expect(CreateCollectiveGoalBodySchema.safeParse({ ...goal, tiers: [] }).success).toBe(true);
  });

  it('apply the newest tier set of the latest period at or before, whatever their order', () => {
    const october = tierSet('0199f2a0-0000-7000-8000-000000000101', '2026-10-01', '2026-09-30T10:00:00Z');
    const november = tierSet('0199f2a0-0000-7000-8000-000000000102', '2026-11-01', '2026-10-20T10:00:00Z');
    const fixed = tierSet('0199f2a0-0000-7000-8000-000000000103', '2026-11-01', '2026-10-21T10:00:00Z');
    const at = (day: string) => bonusTiersFor([fixed, october, november], period(day))?.id ?? null;
    expect(at('2026-09-16')).toBeNull();
    expect(at('2026-10-16')).toBe(october.id);
    expect(at('2026-11-01')).toBe(fixed.id);
    expect(at('2027-01-01')).toBe(fixed.id);
  });

  it('apply the period’s newest goal, none when it has no tier', () => {
    const goal = (id: string, createdAt: string, tiers: { reachedBps: number; bonusMinor: number }[]) =>
      CollectiveGoalSchema.parse({
        id,
        period: '2026-11-01',
        targetMinor: 1_000_000,
        tiers,
        createdBy: USER,
        createdAt,
      });
    const first = goal('0199f2a0-0000-7000-8000-000000000201', '2026-11-01T10:00:00Z', [
      { reachedBps: 10_000, bonusMinor: 3_000 },
    ]);
    const withdrawn = goal('0199f2a0-0000-7000-8000-000000000202', '2026-11-03T10:00:00Z', []);
    expect(collectiveGoalFor([first], period('2026-11-01'))?.id).toBe(first.id);
    expect(collectiveGoalFor([first], period('2026-11-16'))).toBeNull();
    expect(collectiveGoalFor([withdrawn, first], period('2026-11-01'))).toBeNull();
  });
});

describe('statements', () => {
  it('are validated by the agency, never by their own member, and only as drafts', () => {
    const own = { memberId: MEMBER, status: 'draft' } as const;
    expect(mayValidateStatement(own, { scope: 'owner', memberId: null })).toBe(true);
    expect(mayValidateStatement(own, { scope: 'agency', memberId: USER })).toBe(true);
    expect(mayValidateStatement(own, { scope: 'agency', memberId: MEMBER })).toBe(false);
    expect(mayValidateStatement(own, { scope: 'self', memberId: USER })).toBe(false);
    expect(mayValidateStatement({ ...own, status: 'validated' }, { scope: 'owner', memberId: null })).toBe(
      false,
    );
  });

  it('give every error code a suffix that sets its status (api.md)', () => {
    for (const code of PAYROLL_ERROR_CODES) {
      expect(code).toMatch(/_(not_found|invalid|conflict|unprocessable|forbidden)$/u);
    }
  });
});

describe('payments', () => {
  // Invented, with their check digits computed: a French, a Swiss and a Beninese IBAN (UEMOA, outside SWIFT's registry).
  const IBANS = ['FR6212345678900000ABC123456', 'CH3108390123456789012', 'BJ75BC0100100100000012345678'];
  const spaced = (iban: string) => iban.replace(/(.{4})/g, '$1 ').trim();
  const pay = (reference: string) =>
    PayCommissionStatementBodySchema.safeParse({
      revision: 1,
      paidOn: '2026-11-02',
      method: 'worldremit',
      reference,
      sentMinor: 13_333,
    });

  it('refuse a reference that holds an IBAN, alone or in a sentence, with or without spaces', () => {
    for (const iban of IBANS)
      for (const reference of [iban, spaced(iban), iban.toLowerCase(), `Transfert ${spaced(iban)} reçu`]) {
        expect(containsIban(reference), reference).toBe(true);
        const refused = pay(reference);
        expect(refused.success, reference).toBe(false);
        expect(refused.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
          [['reference'], 'Une référence de transfert, jamais un IBAN'],
        ]);
      }
  });

  it('keep a transfer’s reference, a wrong check digit included', () => {
    const wrongKey = ['FR6312345678900000ABC123456', 'CH3208390123456789012', 'BJ76BC0100100100000012345678'];
    for (const reference of [
      ...wrongKey,
      ...wrongKey.map(spaced),
      'P2P-4E7F2C1A',
      'Transfer #1284759302',
      '8MC585209K746392H',
      'Commission du 16 au 31 octobre',
      'FR76',
    ]) {
      expect(containsIban(reference), reference).toBe(false);
      expect(pay(reference).success, reference).toBe(true);
    }
  });

  it('take WorldRemit only: the chatters are paid by it, an old or unknown method is refused', () => {
    const by = (method: string) =>
      PayCommissionStatementBodySchema.safeParse({
        revision: 1,
        paidOn: '2026-11-02',
        method,
        sentMinor: 13_333,
      });
    expect(PAYMENT_METHODS).toEqual(['worldremit']);
    expect(by('worldremit').success).toBe(true);
    for (const method of ['bank_transfer', 'wise', 'paypal', 'other', 'WorldRemit', '']) {
      expect(
        by(method).error?.issues.map((issue) => issue.path),
        method,
      ).toEqual([['method']]);
    }
  });
});

describe('exchange rates', () => {
  it('are copied in one order, by currency, whatever order they were read in', () => {
    // The database compares a statement's rates with its closing's as written (ADR 0032): one order for every writer.
    const rates = [{ currency: 'USD' }, { currency: 'CHF' }, { currency: 'GBP' }];
    expect(canonicalExchangeRates(rates).map((rate) => rate.currency)).toEqual(['CHF', 'GBP', 'USD']);
    expect(canonicalExchangeRates([...rates].reverse())).toEqual(canonicalExchangeRates(rates));
    expect(rates.map((rate) => rate.currency)).toEqual(['USD', 'CHF', 'GBP']);
  });
});

describe('a blocked period', () => {
  const since = '2026-11-02T09:00:00.000Z';

  it('says which members lack a rate, or which currency', () => {
    expect(
      PayPeriodBlockSchema.parse({ code: 'commission_rate_missing_conflict', memberIds: [MEMBER], since }),
    ).toEqual({ code: 'commission_rate_missing_conflict', memberIds: [MEMBER], since });
    // A member reads only themselves among those without a rate: possibly nobody.
    expect(
      PayPeriodBlockSchema.safeParse({ code: 'commission_rate_missing_conflict', memberIds: [], since })
        .success,
    ).toBe(true);
    expect(
      PayPeriodBlockSchema.safeParse({ code: 'exchange_rate_missing_conflict', currency: 'USD', since })
        .success,
    ).toBe(true);
    // The euro is never converted, so it never lacks a rate; an unknown reason is refused, never shown as fine.
    expect(
      PayPeriodBlockSchema.safeParse({ code: 'exchange_rate_missing_conflict', currency: 'EUR', since })
        .success,
    ).toBe(false);
    expect(PayPeriodBlockSchema.safeParse({ code: 'pay_period_order_conflict', since }).success).toBe(false);
    for (const code of PAY_PERIOD_BLOCK_CODES) expect(PAYROLL_ERROR_CODES).toContain(code);
  });

  it('always says whether a period is blocked: a read without it is refused', () => {
    const window = {
      period: '2026-11-01',
      startsAt: '2026-10-31T23:00:00.000Z',
      endsAt: '2026-11-15T23:00:00.000Z',
      timeZone: 'Europe/Paris',
    };
    const summary = {
      window,
      ended: true,
      closedAt: null,
      closedBy: null,
      statements: { draft: 1, validated: 0, paid: 0, carried: 0 },
      netMinor: 0,
      payableMinor: 0,
      validatedPayableMinor: 0,
      carriedMinor: 0,
      paidMinor: 0,
    };
    expect(PayPeriodSummarySchema.safeParse(summary).success).toBe(false);
    expect(PayPeriodSummarySchema.parse({ ...summary, blocked: null }).blocked).toBeNull();
    const block = { code: 'exchange_rate_missing_conflict', currency: 'USD', since };
    expect(PayPeriodSummarySchema.parse({ ...summary, blocked: block }).blocked).toEqual(block);
    const periodRead = {
      period: '2026-11-01',
      window,
      ended: true,
      closing: null,
      beforeFirstClosing: false,
      statements: [],
      bonusTiers: null,
      collectiveGoal: null,
      settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
    };
    expect(PayrollPeriodSchema.safeParse(periodRead).success).toBe(false);
    expect(PayrollPeriodSchema.parse({ ...periodRead, blocked: null }).blocked).toBeNull();
  });
});

describe('carry-overs (ADR 0038)', () => {
  const carry = (amountMinor: number, rank?: number) => ({
    id: '0199f2a0-0000-7000-8000-0000000000c1',
    memberId: '0199f2a0-0000-7000-8000-0000000000c2',
    fromPeriod: '2026-11-01',
    toPeriod: '2026-11-16',
    amountMinor,
    ...(rank === undefined ? {} : { rank }),
    statementId: '0199f2a0-0000-7000-8000-0000000000c3',
    createdAt: '2026-11-17T09:00:00.000Z',
  });

  it('carry a positive amount twice at most, a negative one always at rank 1', () => {
    expect(CarryOverSchema.parse(carry(900, 1)).rank).toBe(1);
    expect(CarryOverSchema.parse(carry(1_300, 2)).rank).toBe(2);
    expect(CarryOverSchema.safeParse(carry(1_400, 3)).success).toBe(false);
    expect(CarryOverSchema.safeParse(carry(-500, 2)).success).toBe(false);
    expect(CarryOverSchema.parse(carry(-500, 1)).rank).toBe(1);
  });

  it('read a carry-over counted before the rank existed as a first one', () => {
    expect(CarryOverSchema.parse(carry(900)).rank).toBe(1);
  });

  it('give what a statement carries the rank after the positive one that came in, 1 otherwise', () => {
    const ranked = (amountMinor: number, rank: number) => ({ amountMinor, rank });
    expect(positiveCarryRankIn([])).toBe(0);
    expect(positiveCarryRankIn([ranked(-500, 1)])).toBe(0);
    expect(positiveCarryRankIn([ranked(1_300, 2)])).toBe(2);
    expect(carryOverRank([], 900)).toBe(1);
    expect(carryOverRank([ranked(900, 1)], 1_300)).toBe(2);
    // A negative amount carried, in or out, starts the count again.
    expect(carryOverRank([ranked(-500, 1)], 400)).toBe(1);
    expect(carryOverRank([ranked(900, 1)], -300)).toBe(1);
  });
});

describe('the payout minimum and delay (PAIE-22, PAIE-32)', () => {
  const minimum = (id: string, fromPeriod: string, createdAt: string, minimumPayoutMinor: number) =>
    PayoutMinimumSchema.parse({ id, fromPeriod, minimumPayoutMinor, createdBy: USER, createdAt });
  const a = minimum('0199f2a0-0000-7000-8000-0000000000a1', '2026-11-01', '2026-10-20T10:00:00.000Z', 2_000);
  const b = minimum('0199f2a0-0000-7000-8000-0000000000a2', '2026-11-01', '2026-10-21T10:00:00.000Z', 2_500);
  const c = minimum('0199f2a0-0000-7000-8000-0000000000a3', '2026-12-01', '2026-10-21T11:00:00.000Z', 3_000);

  it('reads the newest of the latest period at or before, and the first change after', () => {
    expect(payoutMinimumFor([a, b, c], period('2026-10-16'))).toBeNull();
    expect(payoutMinimumFor([c, b, a], period('2026-11-16'))?.minimumPayoutMinor).toBe(2_500);
    expect(payoutMinimumFor([a, b, c], period('2026-12-01'))?.minimumPayoutMinor).toBe(3_000);
    expect(nextPayoutMinimum([c, a, b], period('2026-10-16'))?.minimumPayoutMinor).toBe(2_500);
    expect(nextPayoutMinimum([a, b, c], period('2026-11-01'))?.minimumPayoutMinor).toBe(3_000);
    expect(nextPayoutMinimum([a, b, c], period('2026-12-01'))).toBeNull();
  });

  it('takes a delay in whole business days, from 1 to 30, or none', () => {
    expect(UpdatePayrollSettingsBodySchema.safeParse({ payoutDelayBusinessDays: 3 }).success).toBe(true);
    expect(UpdatePayrollSettingsBodySchema.safeParse({ payoutDelayBusinessDays: null }).success).toBe(true);
    for (const wrong of [0, 31, 2.5, '3']) {
      expect(UpdatePayrollSettingsBodySchema.safeParse({ payoutDelayBusinessDays: wrong }).success).toBe(
        false,
      );
    }
    expect(
      PayrollSettingsSchema.parse({
        minimumPayoutMinor: 1_500,
        nextMinimum: null,
        payoutDelayBusinessDays: null,
      }),
    ).toEqual({ minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null });
  });
});
