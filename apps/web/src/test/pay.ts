import {
  BonusTierSetSchema,
  BonusViewSchema,
  CollectiveGoalSchema,
  CommissionStatementLineSchema,
  CommissionStatementSchema,
  PayAdjustmentViewSchema,
  PayrollEntriesSchema,
  PayrollPeriodSchema,
  PenaltyViewSchema,
  TeamMemberSchema,
  type BonusTierSet,
  type BonusView,
  type CollectiveGoal,
  type CommissionStatement,
  type CommissionStatementLine,
  type Me,
  type PayAdjustmentView,
  type PayPeriodSummary,
  type PayrollEntries,
  type PayrollPeriod,
  type PenaltyView,
  type TeamMember,
} from '@nirvana/contracts';

/*
 * Pay's fakes, shared by Paie's and Commissions' tests (EQ-05): an invented team (ADR 0010) — Théo, Basile and Lou
 * chat, Iris manages — on Nora Vidal's Reveal account in euros and Léa's OnlyFans account in dollars. Théo lives in
 * Benin (CFA franc zone), Lou in Madagascar, the others in France. Each fake is parsed with its contract, so a test
 * never feeds a screen what the server could not send.
 */

export const payId = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;

export const OWNER_USER = payId(1);

const me = { email: 'compte@example.test', creatorIds: [], routedCreatorIds: [] };
export const OWNER: Me = {
  ...me,
  id: OWNER_USER,
  name: 'Charles',
  role: 'owner',
  team: null,
  teamScope: 'owner',
};
export const IRIS_ME: Me = {
  ...me,
  id: payId(34),
  name: 'Iris',
  role: 'operator',
  team: { role: 'manager', status: 'active' },
  teamScope: 'agency',
};
export const THEO_ME: Me = {
  ...me,
  id: payId(31),
  name: 'Théo',
  role: 'operator',
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};

function member(
  n: number,
  displayName: string,
  teamRole: 'chatter' | 'manager',
  color: string,
  country = 'FR',
): TeamMember {
  return TeamMemberSchema.parse({
    id: payId(20 + n),
    userId: payId(30 + n),
    email: `membre${String(n)}@example.test`,
    firstName: displayName,
    lastName: 'Exemple',
    displayName,
    teamRole,
    status: 'active',
    country,
    timeZone: 'Europe/Paris',
    color,
    joinedOn: '2026-09-01',
    creatorIds: [payId(2)],
    commission: null,
    invitationPending: false,
    invitationExpiresAt: null,
  });
}

export const THEO = member(1, 'Théo', 'chatter', '#5b8def', 'BJ');
export const BASILE = member(2, 'Basile', 'chatter', '#e0a142');
export const LOU = member(3, 'Lou', 'chatter', '#8bc34a', 'MG');
export const IRIS = member(4, 'Iris', 'manager', '#c86dd7');
export const MEMBERS = [THEO, BASILE, LOU, IRIS];

export const NORA_REVEAL = {
  id: payId(11),
  creatorId: payId(2),
  creatorName: 'Nora Vidal',
  platform: 'reveal',
  handle: 'nora',
} as const;
export const LEA_ONLYFANS = {
  id: payId(12),
  creatorId: payId(3),
  creatorName: 'Léa',
  platform: 'onlyfans',
  handle: 'lea',
} as const;

/** The pay rules' list as `/v1/team/pay-rules` gives it: the accounts, no rules needed by pay's screens. */
export const PAY_RULES = {
  currentPeriod: '2026-11-01',
  accounts: [
    { account: NORA_REVEAL, rules: [] },
    { account: LEA_ONLYFANS, rules: [] },
  ],
};

export const OCT1 = '2026-10-01';
export const OCT2 = '2026-10-16';
export const NOV1 = '2026-11-01';
export const NOV2 = '2026-11-16';

const WINDOWS: Readonly<Record<string, { startsAt: string; endsAt: string }>> = {
  [OCT1]: { startsAt: '2026-09-30T22:00:00.000Z', endsAt: '2026-10-15T22:00:00.000Z' },
  [OCT2]: { startsAt: '2026-10-15T22:00:00.000Z', endsAt: '2026-10-31T23:00:00.000Z' },
  [NOV1]: { startsAt: '2026-10-31T23:00:00.000Z', endsAt: '2026-11-15T23:00:00.000Z' },
  [NOV2]: { startsAt: '2026-11-15T23:00:00.000Z', endsAt: '2026-11-30T23:00:00.000Z' },
};

const windowOf = (period: string): { period: string; startsAt: string; endsAt: string; timeZone: string } => {
  const bounds = WINDOWS[period];
  if (bounds === undefined) throw new Error(`No window for ${period}`);
  return { period, ...bounds, timeZone: 'Europe/Paris' };
};

/** An account's line in euros on Nora's Reveal: 120 € of sales, 20 % VAT, 15 % fee, 25 % commission. */
export function euroLine(
  patch: Partial<Record<keyof CommissionStatementLine, unknown>> = {},
): CommissionStatementLine {
  return CommissionStatementLineSchema.parse({
    platformAccountId: NORA_REVEAL.id,
    currency: 'EUR',
    vatBps: 2_000,
    platformFeeBps: 1_500,
    rateMicros: 1_000_000,
    grossMinor: 12_000,
    grossEurMinor: 12_000,
    exclVatMinor: 10_000,
    netMinor: 8_500,
    commissionMinor: 2_125,
    shiftReportIds: [payId(301), payId(302)],
    lateReports: [],
    ...patch,
  });
}

/** A draft of `whose` for `period`, one euro line, nothing else: `patch` says the rest. */
export function statementOf(
  whose: TeamMember,
  period: string,
  patch: Partial<Record<keyof CommissionStatement, unknown>> = {},
): CommissionStatement {
  return CommissionStatementSchema.parse({
    id: payId(400 + (Number(whose.id.slice(-2)) - 20) * 10 + [OCT1, OCT2, NOV1].indexOf(period)),
    memberId: whose.id,
    window: windowOf(period),
    status: 'draft',
    revision: 3,
    engineVersion: 'nirvana-1',
    inputsHash: '3f9c'.padEnd(60, '0') + 'a41e',
    lines: [euroLine()],
    netMinor: 8_500,
    commissionMinor: 2_125,
    teamShare: null,
    tierBonus: null,
    collectiveBonusMinor: 0,
    bonuses: [],
    penalties: [],
    carryOversIn: [],
    adjustments: [],
    bonusesMinor: 0,
    penaltiesRequestedMinor: 0,
    penaltiesMinor: 0,
    carryOversInMinor: 0,
    adjustmentsMinor: 0,
    totalMinor: 2_125,
    carryOverOutMinor: 0,
    payableMinor: 2_125,
    team: null,
    rules: {
      commissionRateBps: 2_500,
      teamShareBps: null,
      bonusTiers: [],
      collectiveGoal: null,
      minimumPayoutMinor: 1_500,
      exchangeRates: [],
      final: false,
    },
    canValidate: true,
    computedAt: '2026-11-02T09:07:00.000Z',
    validatedAt: null,
    validatedBy: null,
    paidAt: null,
    paidBy: null,
    payment: null,
    ...patch,
  });
}

/** A period as `/v1/payroll/periods/:period` gives it. */
export function periodOf(
  period: string,
  statements: readonly CommissionStatement[],
  patch: Partial<Record<keyof PayrollPeriod, unknown>> = {},
): PayrollPeriod {
  return PayrollPeriodSchema.parse({
    period,
    window: windowOf(period),
    ended: period < NOV1,
    beforeFirstClosing: false,
    blocked: null,
    closing: null,
    statements,
    bonusTiers: null,
    collectiveGoal: null,
    settings: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null },
    ...patch,
  });
}

/** A line of `/v1/payroll/periods`, summed from the period as the server sums it. */
export function summaryFor(period: PayrollPeriod): PayPeriodSummary {
  const count = (status: string) => period.statements.filter((one) => one.status === status).length;
  const sum = (pick: (one: CommissionStatement) => number) =>
    period.statements.reduce((total, one) => total + pick(one), 0);
  if (period.window === null) throw new Error(`${period.period} has no window`);
  return {
    window: period.window,
    ended: period.ended,
    closedAt: period.closing?.closedAt ?? null,
    closedBy: period.closing?.closedBy ?? null,
    blocked: period.blocked,
    statements: {
      draft: count('draft'),
      validated: count('validated'),
      paid: count('paid'),
      carried: period.statements.filter((one) => one.carryOverOutMinor !== 0 && one.status !== 'draft')
        .length,
    },
    netMinor: sum((one) => one.netMinor),
    payableMinor: sum((one) => one.payableMinor),
    validatedPayableMinor: sum((one) => (one.status === 'draft' ? 0 : one.payableMinor)),
    carriedMinor: sum((one) => (one.status === 'draft' ? 0 : one.carryOverOutMinor)),
    paidMinor: sum((one) => one.payment?.sentMinor ?? 0),
  };
}

export const SCHEDULING_SETTINGS = {
  timeZone: 'Europe/Paris',
  slotStartMinute: 0,
  slotLengthMinutes: 360,
  accessMarginMinutes: 15,
};

/** A bonus of `whose` for `period`, made by the owner: `n` tells it apart. */
export function bonusOf(
  n: number,
  whose: TeamMember,
  period: string,
  patch: Partial<Record<keyof BonusView, unknown>> = {},
): BonusView {
  return BonusViewSchema.parse({
    id: payId(700 + n),
    memberId: whose.id,
    period,
    amountMinor: 3_000,
    reason: 'A formé un nouveau aux relances, deux soirs.',
    createdBy: OWNER_USER,
    createdAt: '2026-11-09T10:00:00.000Z',
    cancellation: null,
    ...patch,
  });
}

/** A fixed penalty on `whose` for `period` alone, made by the owner. */
export function penaltyOf(
  n: number,
  whose: TeamMember,
  period: string,
  patch: Partial<Record<keyof PenaltyView, unknown>> = {},
): PenaltyView {
  return PenaltyViewSchema.parse({
    id: payId(720 + n),
    memberId: whose.id,
    fromPeriod: period,
    toPeriod: period,
    amount: { kind: 'fixed', amountMinor: 1_500 },
    reason: 'Shift commencé avec 40 minutes de retard.',
    createdBy: OWNER_USER,
    createdAt: '2026-11-05T10:00:00.000Z',
    cancellation: null,
    ...patch,
  });
}

/** An adjustment of `whose` landed on `period`, made by the owner. */
export function adjustmentOf(
  n: number,
  whose: TeamMember,
  period: string,
  patch: Partial<Record<keyof PayAdjustmentView, unknown>> = {},
): PayAdjustmentView {
  return PayAdjustmentViewSchema.parse({
    id: payId(740 + n),
    memberId: whose.id,
    period,
    amountMinor: -1_240,
    reason: 'Rapport du 28 oct. compté deux fois.',
    correctsStatementId: null,
    createdBy: OWNER_USER,
    createdAt: '2026-11-03T10:00:00.000Z',
    ...patch,
  });
}

/** The team's goal for `period`: 1 500 € of net, 80 % brings each chatter 10 €, 100 % brings 25 €. */
export function goalOf(
  period: string,
  patch: Partial<Record<keyof CollectiveGoal, unknown>> = {},
): CollectiveGoal {
  return CollectiveGoalSchema.parse({
    id: payId(760 + [OCT1, OCT2, NOV1, NOV2].indexOf(period)),
    period,
    targetMinor: 150_000,
    tiers: [
      { reachedBps: 10_000, bonusMinor: 2_500 },
      { reachedBps: 8_000, bonusMinor: 1_000 },
    ],
    createdBy: OWNER_USER,
    createdAt: '2026-10-30T17:00:00.000Z',
    ...patch,
  });
}

/** Individual tiers from `fromPeriod` on: Bronze at 500 € of net brings 10 €, Argent at 1 000 € brings 25 €. */
export function tierSetOf(
  n: number,
  fromPeriod: string,
  patch: Partial<Record<keyof BonusTierSet, unknown>> = {},
): BonusTierSet {
  return BonusTierSetSchema.parse({
    id: payId(780 + n),
    fromPeriod,
    tiers: [
      { label: 'Argent', thresholdMinor: 100_000, bonusMinor: 2_500 },
      { label: 'Bronze', thresholdMinor: 50_000, bonusMinor: 1_000 },
    ],
    createdBy: OWNER_USER,
    createdAt: '2026-09-28T17:00:00.000Z',
    ...patch,
  });
}

/** A period's entries as `/v1/payroll/entries` gives them. */
export const entriesOf = (
  period: string,
  entries: { bonuses?: unknown[]; penalties?: unknown[]; adjustments?: unknown[] } = {},
): PayrollEntries =>
  PayrollEntriesSchema.parse({ period, bonuses: [], penalties: [], adjustments: [], ...entries });
