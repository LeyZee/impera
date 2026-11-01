import { carryOverRank, DomainError } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import {
  computeCommissionStatements,
  ENGINE_VERSION,
  type AccountEarnings,
  type MemberPayInput,
  type PeriodPayInput,
  type CommissionStatement,
} from '../commission-statements';
import { mulDivRound } from '../rounding';

/*
 * Reference cases, one per rule of Imperium the ADR lists (EQ-04). Invented amounts, every figure worked out by hand
 * in the comment above it: the engine must find the same cent.
 */

const USD_AT_092 = { currency: 'USD', rateMicros: 920_000, source: 'test', day: '2026-10-31' } as const;

const account = (patch: Partial<AccountEarnings> & { grossMinor: number }): AccountEarnings => ({
  platformAccountId: 'account-a',
  currency: 'EUR',
  vatBps: 0,
  platformFeeBps: 0,
  ...patch,
});

const chatter = (memberId: string, patch: Partial<MemberPayInput> = {}): MemberPayInput => ({
  memberId,
  teamRole: 'chatter',
  commissionRateBps: 2_000,
  teamShareBps: null,
  collectiveEligible: true,
  final: false,
  accounts: [],
  manualBonuses: [],
  penalties: [],
  carryOversIn: [],
  adjustments: [],
  ...patch,
});

const manager = (memberId: string, patch: Partial<MemberPayInput> = {}): MemberPayInput =>
  chatter(memberId, { teamRole: 'manager', teamShareBps: null, collectiveEligible: false, ...patch });

const period = (members: MemberPayInput[], patch: Partial<PeriodPayInput> = {}): PeriodPayInput => ({
  rates: [USD_AT_092],
  bonusTiers: [],
  collectiveGoal: null,
  minimumPayoutMinor: 0,
  members,
  ...patch,
});

function statementOf(input: PeriodPayInput, memberId: string): CommissionStatement {
  const found = computeCommissionStatements(input).statements.find((one) => one.memberId === memberId);
  if (found === undefined) throw new Error(`no statement for ${memberId}`);
  return found;
}

describe('the rounding of pay', () => {
  it('rounds half away from zero, negatives included, and only there', () => {
    expect(mulDivRound(5, 1, 10)).toBe(1);
    expect(mulDivRound(-5, 1, 10)).toBe(-1);
    expect(mulDivRound(15, 1, 10)).toBe(2);
    expect(mulDivRound(-15, 1, 10)).toBe(-2);
    expect(mulDivRound(14, 1, 10)).toBe(1);
    expect(mulDivRound(-14, 1, 10)).toBe(-1);
    expect(Object.is(mulDivRound(-4, 1, 10), 0)).toBe(true);
  });

  it('keeps every digit of a product past 2^53', () => {
    // 3 000 000 000 000 × 9 000 = 2,7 × 10^16 ; ÷ 7 = 3 857 142 857 142 857,14… → …857.
    expect(mulDivRound(3_000_000_000_000, 9_000, 7)).toBe(3_857_142_857_142_857);
  });

  it('takes integers only', () => {
    expect(() => mulDivRound(1.5, 1, 1)).toThrow(RangeError);
    expect(() => mulDivRound(1, 1, 0)).toThrow(RangeError);
  });
});

describe('a member’s share, account by account (Imperium’s chain)', () => {
  it('takes a euro account through VAT and the platform’s commission', () => {
    // 1 000,00 € gross, VAT 20 %, platform 20 %, member 20 %:
    // 100 000 ÷ 1,2 = 83 333,33 → 83 333 ; × 0,8 = 66 666,4 → 66 666 ; × 0,2 = 13 333,2 → 13 333.
    const one = statementOf(
      period([
        chatter('lea', {
          accounts: [account({ grossMinor: 100_000, vatBps: 2_000, platformFeeBps: 2_000 })],
        }),
      ]),
      'lea',
    );
    expect(one.lines).toEqual([
      {
        platformAccountId: 'account-a',
        currency: 'EUR',
        grossMinor: 100_000,
        rateMicros: 1_000_000,
        grossEurMinor: 100_000,
        exclVatMinor: 83_333,
        netMinor: 66_666,
        commissionMinor: 13_333,
      },
    ]);
    expect(one.totalMinor).toBe(13_333);
    expect(one.payableMinor).toBe(13_333);
  });

  it('converts a dollar account without VAT at the rate it copies', () => {
    // 500,00 $ × 0,92 = 460,00 € ; no VAT ; platform 20 % → 368,00 € ; member 25 % → 92,00 €.
    const one = statementOf(
      period([
        chatter('theo', {
          commissionRateBps: 2_500,
          accounts: [account({ currency: 'USD', grossMinor: 50_000, platformFeeBps: 2_000 })],
        }),
      ]),
      'theo',
    );
    expect(one.lines[0]).toMatchObject({ rateMicros: 920_000, grossEurMinor: 46_000, netMinor: 36_800 });
    expect(one.commissionMinor).toBe(9_200);
  });

  it('rounds on the account’s total for the period, never sale by sale', () => {
    // Three reports of 10,00 € at 20 % VAT: 3 000 ÷ 1,2 = 2 500 ; sale by sale it would be 3 × 833 = 2 499.
    const one = statementOf(
      period([chatter('ines', { accounts: [account({ grossMinor: 3_000, vatBps: 2_000 })] })]),
      'ines',
    );
    expect(one.lines[0]?.exclVatMinor).toBe(2_500);
  });

  it('adds up several accounts, each rounded on its own', () => {
    // 100,00 € → commission 20,00 € ; 50,00 $ × 0,92 = 46,00 € → 9,20 €. Net 146,00 €, commission 29,20 €.
    const one = statementOf(
      period([
        chatter('lou', {
          accounts: [
            account({ platformAccountId: 'account-a', grossMinor: 10_000 }),
            account({ platformAccountId: 'account-b', currency: 'USD', grossMinor: 5_000 }),
          ],
        }),
      ]),
      'lou',
    );
    expect([one.netMinor, one.commissionMinor]).toEqual([14_600, 2_920]);
  });

  it('rounds half a cent away from zero, up and down', () => {
    // 123,45 € at 10 % = 12,345 € → 12,35 € ; a late refund of 123,45 € → −12,35 €.
    const up = statementOf(
      period([chatter('iris', { commissionRateBps: 1_000, accounts: [account({ grossMinor: 12_345 })] })]),
      'iris',
    );
    const down = statementOf(
      period([chatter('iris', { commissionRateBps: 1_000, accounts: [account({ grossMinor: -12_345 })] })]),
      'iris',
    );
    expect(up.commissionMinor).toBe(1_235);
    expect(down.commissionMinor).toBe(-1_235);
  });

  it('never guesses a rate it was not given', () => {
    const input = period([chatter('basile', { accounts: [account({ currency: 'USD', grossMinor: 100 })] })], {
      rates: [],
    });
    expect(() => computeCommissionStatements(input)).toThrow(DomainError);
    try {
      computeCommissionStatements(input);
    } catch (error) {
      expect(error instanceof DomainError ? error.code : null).toBe('exchange_rate_missing_conflict');
    }
  });
});

describe('bonuses', () => {
  const TIERS = [
    { thresholdMinor: 50_000, bonusMinor: 2_000 },
    { thresholdMinor: 100_000, bonusMinor: 5_000 },
  ];

  it('pays the highest tier reached, a threshold reached to the cent included', () => {
    // Net 500,00 € exactly: the 500 € tier (20,00 €), not the 1 000 € one. Commission 100,00 €, total 120,00 €.
    const exactly = statementOf(
      period([chatter('lea', { accounts: [account({ grossMinor: 50_000 })] })], { bonusTiers: TIERS }),
      'lea',
    );
    expect(exactly.tierBonus).toEqual({ thresholdMinor: 50_000, bonusMinor: 2_000 });
    expect(exactly.totalMinor).toBe(12_000);

    const both = statementOf(
      period([chatter('lea', { accounts: [account({ grossMinor: 150_000 })] })], { bonusTiers: TIERS }),
      'lea',
    );
    expect(both.tierBonus?.bonusMinor).toBe(5_000);

    const short = statementOf(
      period([chatter('lea', { accounts: [account({ grossMinor: 49_999 })] })], { bonusTiers: TIERS }),
      'lea',
    );
    expect(short.tierBonus).toBeNull();
  });

  it('pays the collective goal to every chatter it covers, sales or not, never to a manager', () => {
    // Target 1 000,00 €. Léa nets 600,00 €, the manager Nora 500,00 €: the team nets 1 100,00 € = 110 % of the target,
    // past the 100 % tier (30,00 € each), short of 120 %. Théo sold nothing and is paid it too; Basile left.
    const input = period(
      [
        chatter('lea', { accounts: [account({ grossMinor: 60_000 })] }),
        chatter('theo'),
        chatter('basile', { collectiveEligible: false }),
        manager('nora', { teamShareBps: 500, accounts: [account({ grossMinor: 50_000 })] }),
      ],
      {
        collectiveGoal: {
          targetMinor: 100_000,
          tiers: [
            { reachedBps: 10_000, bonusMinor: 3_000 },
            { reachedBps: 12_000, bonusMinor: 6_000 },
          ],
        },
      },
    );
    const result = computeCommissionStatements(input);
    expect(result.teamNetMinor).toBe(110_000);
    expect(result.collective).toEqual({
      reachedBps: 11_000,
      tier: { reachedBps: 10_000, bonusMinor: 3_000 },
    });
    // Léa: commission 120,00 € + 30,00 €.
    expect(statementOf(input, 'lea')).toMatchObject({ collectiveBonusMinor: 3_000, totalMinor: 15_000 });
    expect(statementOf(input, 'theo')).toMatchObject({
      commissionMinor: 0,
      collectiveBonusMinor: 3_000,
      totalMinor: 3_000,
    });
    expect(result.statements.some((one) => one.memberId === 'basile')).toBe(false);
    // Nora: commission 100,00 € + 5 % of the others' 600,00 € = 30,00 €; no collective bonus.
    expect(statementOf(input, 'nora')).toMatchObject({
      collectiveBonusMinor: 0,
      teamShare: { baseNetMinor: 60_000, bps: 500, amountMinor: 3_000 },
      totalMinor: 13_000,
    });
  });

  it('adds manual bonuses, a manager’s included, and keeps tiers away from managers', () => {
    // Iris: commission 20,00 € + 15,00 €. Nora, manager: commission 200,00 € + 50,00 €, no tier for her 1 000 € net.
    const input = period(
      [
        chatter('iris', {
          accounts: [account({ grossMinor: 10_000 })],
          manualBonuses: [{ id: 'b1', amountMinor: 1_500 }],
        }),
        manager('nora', {
          accounts: [account({ grossMinor: 100_000 })],
          manualBonuses: [{ id: 'b2', amountMinor: 5_000 }],
        }),
      ],
      { bonusTiers: [{ thresholdMinor: 50_000, bonusMinor: 2_000 }] },
    );
    expect(statementOf(input, 'iris')).toMatchObject({
      manualBonusesMinor: 1_500,
      bonusesMinor: 1_500,
      totalMinor: 3_500,
    });
    expect(statementOf(input, 'nora')).toMatchObject({
      tierBonus: null,
      bonusesMinor: 5_000,
      totalMinor: 25_000,
    });
  });
});

describe('penalties', () => {
  it('takes a percent penalty on the member’s net', () => {
    // Net 666,66 € (the euro case), 10 % → 66,666 € → 66,67 € ; commission 133,33 € − 66,67 € = 66,66 €.
    const one = statementOf(
      period([
        chatter('lea', {
          accounts: [account({ grossMinor: 100_000, vatBps: 2_000, platformFeeBps: 2_000 })],
          penalties: [{ id: 'p1', kind: 'percent', bps: 1_000 }],
        }),
      ]),
      'lea',
    );
    expect([one.penaltiesRequestedMinor, one.penaltiesMinor, one.totalMinor]).toEqual([6_667, 6_667, 6_666]);
  });

  it('caps penalties at the member’s share plus bonuses: a statement is never negative', () => {
    // Commission 20,00 € + bonus 10,00 € = 30,00 € ; penalties of 50,00 € + 5 % of 100,00 € = 55,00 € → 30,00 €.
    const one = statementOf(
      period([
        chatter('theo', {
          accounts: [account({ grossMinor: 10_000 })],
          manualBonuses: [{ id: 'b1', amountMinor: 1_000 }],
          penalties: [
            { id: 'p1', kind: 'fixed', amountMinor: 5_000 },
            { id: 'p2', kind: 'percent', bps: 500 },
          ],
        }),
      ]),
      'theo',
    );
    expect([one.penaltiesRequestedMinor, one.penaltiesMinor, one.totalMinor]).toEqual([5_500, 3_000, 0]);
  });

  it('says a penalty with nothing to take it from', () => {
    const one = statementOf(
      period([chatter('ines', { penalties: [{ id: 'p1', kind: 'fixed', amountMinor: 2_000 }] })]),
      'ines',
    );
    expect([one.penaltiesRequestedMinor, one.penaltiesMinor, one.totalMinor]).toEqual([2_000, 0, 0]);
  });
});

describe('a manager’s share of the team', () => {
  it('takes the share on the others’ net and the commission on the manager’s own', () => {
    // Nora nets 200,00 € herself, Léa and Théo 800,00 € together: 10 % × 800,00 € = 80,00 €, plus 20 % × 200,00 €.
    const input = period([
      manager('nora', { teamShareBps: 1_000, accounts: [account({ grossMinor: 20_000 })] }),
      chatter('lea', { accounts: [account({ grossMinor: 50_000 })] }),
      chatter('theo', { accounts: [account({ grossMinor: 30_000 })] }),
    ]);
    expect(statementOf(input, 'nora')).toMatchObject({
      commissionMinor: 4_000,
      teamShare: { baseNetMinor: 80_000, bps: 1_000, amountMinor: 8_000 },
      totalMinor: 12_000,
    });
  });

  it('pays the share to a manager who sold nothing', () => {
    const input = period([
      manager('nora', { teamShareBps: 500 }),
      chatter('lea', { accounts: [account({ grossMinor: 40_000 })] }),
    ]);
    expect(statementOf(input, 'nora')).toMatchObject({ commissionMinor: 0, totalMinor: 2_000 });
  });
});

describe('what goes from a period to the next', () => {
  it('carries a total under the payout minimum, then pays it with the next one', () => {
    // Minimum 15,00 €. First period: 50,00 € net × 20 % = 10,00 € → carried. Second: 10,00 € + 10,00 € → paid.
    const first = statementOf(
      period([chatter('lou', { accounts: [account({ grossMinor: 5_000 })] })], { minimumPayoutMinor: 1_500 }),
      'lou',
    );
    expect([first.totalMinor, first.carryOverOutMinor, first.payableMinor]).toEqual([1_000, 1_000, 0]);

    const second = statementOf(
      period(
        [
          chatter('lou', {
            accounts: [account({ grossMinor: 5_000 })],
            carryOversIn: [{ id: 'c1', amountMinor: first.carryOverOutMinor, rank: 1 }],
          }),
        ],
        { minimumPayoutMinor: 1_500 },
      ),
      'lou',
    );
    expect([
      second.carryOversInMinor,
      second.totalMinor,
      second.carryOverOutMinor,
      second.payableMinor,
    ]).toEqual([1_000, 2_000, 0, 2_000]);
  });

  it('carries a lone carry-over that is still under the minimum', () => {
    const one = statementOf(
      period([chatter('lou', { carryOversIn: [{ id: 'c1', amountMinor: 1_000, rank: 1 }] })], {
        minimumPayoutMinor: 1_500,
      }),
      'lou',
    );
    expect([one.totalMinor, one.carryOverOutMinor, one.payableMinor]).toEqual([1_000, 1_000, 0]);
  });

  it('carries a positive amount twice at most: the third period pays it, under the minimum too (ADR 0038)', () => {
    // Minimum 15,00 €. 9,00 €, then 4,00 € (13,00 €), then 1,00 € (14,00 €): carried at rank 1, then 2, then paid.
    const earning = (grossMinor: number) => [account({ grossMinor })];
    const first = statementOf(
      period([chatter('lou', { accounts: earning(4_500) })], { minimumPayoutMinor: 1_500 }),
      'lou',
    );
    expect([first.totalMinor, first.carryOverOutMinor]).toEqual([900, 900]);
    expect(carryOverRank([], first.carryOverOutMinor)).toBe(1);

    const secondIn = [{ id: 'c1', amountMinor: 900, rank: 1 }];
    const second = statementOf(
      period([chatter('lou', { accounts: earning(2_000), carryOversIn: secondIn })], {
        minimumPayoutMinor: 1_500,
      }),
      'lou',
    );
    expect([second.totalMinor, second.carryOverOutMinor, second.payableMinor]).toEqual([1_300, 1_300, 0]);
    expect(carryOverRank(secondIn, second.carryOverOutMinor)).toBe(2);

    const third = statementOf(
      period(
        [
          chatter('lou', {
            accounts: earning(500),
            carryOversIn: [{ id: 'c2', amountMinor: 1_300, rank: 2 }],
          }),
        ],
        { minimumPayoutMinor: 1_500 },
      ),
      'lou',
    );
    expect([third.totalMinor, third.carryOverOutMinor, third.payableMinor]).toEqual([1_400, 0, 1_400]);
  });

  it('keeps counting through a negative period while the total stays positive, and starts again under zero', () => {
    // 9,00 € carried (rank 1), then a period at −5,00 €: 4,00 € left, carried a second time.
    const keptIn = [{ id: 'c1', amountMinor: 900, rank: 1 }];
    const kept = statementOf(
      period([chatter('lou', { adjustments: [{ id: 'a1', amountMinor: -500 }], carryOversIn: keptIn })], {
        minimumPayoutMinor: 1_500,
      }),
      'lou',
    );
    expect([kept.totalMinor, kept.carryOverOutMinor]).toEqual([400, 400]);
    expect(carryOverRank(keptIn, kept.carryOverOutMinor)).toBe(2);

    // Under zero: nothing is paid, the negative total is carried at rank 1, and the next positive one starts at 1.
    const underIn = [{ id: 'c1', amountMinor: 900, rank: 2 }];
    const under = statementOf(
      period([chatter('lou', { adjustments: [{ id: 'a1', amountMinor: -2_000 }], carryOversIn: underIn })], {
        minimumPayoutMinor: 1_500,
      }),
      'lou',
    );
    expect([under.totalMinor, under.carryOverOutMinor, under.payableMinor]).toEqual([-1_100, -1_100, 0]);
    expect(carryOverRank(underIn, under.carryOverOutMinor)).toBe(1);
    const againIn = [{ id: 'c2', amountMinor: -1_100, rank: 1 }];
    const again = statementOf(
      period([chatter('lou', { accounts: [account({ grossMinor: 10_000 })], carryOversIn: againIn })], {
        minimumPayoutMinor: 1_500,
      }),
      'lou',
    );
    expect([again.totalMinor, again.carryOverOutMinor]).toEqual([900, 900]);
    expect(carryOverRank(againIn, again.carryOverOutMinor)).toBe(1);
  });

  it('pays everything on a final statement, under the minimum too', () => {
    const one = statementOf(
      period(
        [
          chatter('lou', {
            final: true,
            accounts: [account({ grossMinor: 5_000 })],
            carryOversIn: [{ id: 'c1', amountMinor: 300, rank: 1 }],
          }),
        ],
        { minimumPayoutMinor: 1_500 },
      ),
      'lou',
    );
    expect([one.totalMinor, one.carryOverOutMinor, one.payableMinor]).toEqual([1_300, 0, 1_300]);
  });

  it('counts a late report in its account’s total of the period it is carried to', () => {
    // A report of 50,00 € validated after its own period: with this period's 100,00 €, the account brings 150,00 €
    // at 20 % VAT: 15 000 ÷ 1,2 = 12 500, once.
    const one = statementOf(
      period([chatter('theo', { accounts: [account({ grossMinor: 10_000 + 5_000, vatBps: 2_000 })] })]),
      'theo',
    );
    expect(one.lines[0]?.exclVatMinor).toBe(12_500);
    expect(one.commissionMinor).toBe(2_500);
  });

  it('takes an adjustment after « payé » on the next open period, never below zero for the payout', () => {
    // A statement paid 40,00 € too much comes back as −40,00 € on the next one: 60,00 € − 40,00 € = 20,00 €.
    const next = statementOf(
      period([
        chatter('iris', {
          accounts: [account({ grossMinor: 30_000 })],
          adjustments: [{ id: 'a1', amountMinor: -4_000 }],
        }),
      ]),
      'iris',
    );
    expect([next.adjustmentsMinor, next.totalMinor, next.payableMinor]).toEqual([-4_000, 2_000, 2_000]);

    // More than the period earns: nothing is paid, and the rest is carried, never paid back negative.
    const short = statementOf(
      period([
        chatter('iris', {
          accounts: [account({ grossMinor: 10_000 })],
          adjustments: [{ id: 'a1', amountMinor: -4_000 }],
        }),
      ]),
      'iris',
    );
    expect([short.totalMinor, short.carryOverOutMinor, short.payableMinor]).toEqual([-2_000, -2_000, 0]);
  });
});

describe('the period', () => {
  it('refuses a member twice, two rates for one currency, or an account twice under the same rules', () => {
    // Each would make the answer hang on the order: the team's net counted twice, the first rate taken, the account's
    // total rounded in two pieces.
    const theo = chatter('theo', { accounts: [account({ grossMinor: 10_000 })] });
    expect(() => computeCommissionStatements(period([theo, chatter('theo')]))).toThrow(RangeError);
    expect(() =>
      computeCommissionStatements(
        period([theo], { rates: [USD_AT_092, { ...USD_AT_092, rateMicros: 930_000 }] }),
      ),
    ).toThrow(RangeError);
    expect(() =>
      computeCommissionStatements(
        period([
          chatter('theo', { accounts: [account({ grossMinor: 10_000 }), account({ grossMinor: 5_000 })] }),
        ]),
      ),
    ).toThrow(RangeError);
    // The same account under other rules (they changed between a late report's period and this one) is a line of its
    // own: in dollars, 10 000 × 0,92 = 9 200 ; in euros at 20 % VAT, 12 000 ÷ 1,2 = 10 000.
    const both = statementOf(
      period([
        chatter('theo', {
          accounts: [
            account({ grossMinor: 10_000 }),
            account({ grossMinor: 10_000, currency: 'USD' }),
            account({ grossMinor: 12_000, vatBps: 2_000 }),
          ],
        }),
      ]),
      'theo',
    );
    expect(both.lines.map((line) => line.netMinor)).toEqual([10_000, 9_200, 10_000]);
    // Same account, same currency, another platform fee: 10 000 × 0,8 = 8 000.
    const fee = statementOf(
      period([
        chatter('theo', {
          accounts: [account({ grossMinor: 10_000 }), account({ grossMinor: 10_000, platformFeeBps: 2_000 })],
        }),
      ]),
      'theo',
    );
    expect(fee.lines.map((line) => line.netMinor)).toEqual([10_000, 8_000]);
  });

  it('makes a statement only for a member with something in it, and says its engine', () => {
    const result = computeCommissionStatements(
      period([chatter('lea'), chatter('theo', { accounts: [account({ grossMinor: 100 })] })]),
    );
    expect(result.engineVersion).toBe(ENGINE_VERSION);
    expect(result.statements.map((one) => one.memberId)).toEqual(['theo']);
  });
});
