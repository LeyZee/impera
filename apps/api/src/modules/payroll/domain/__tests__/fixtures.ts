import {
  newId,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
  type ExchangeRate,
} from '@nirvana/contracts';

import type { MemberForPay, PeriodSnapshot, ReportForPay } from '../recalculation';

/** Invented members and amounts only (ADR 0010). */
export const P1 = PayPeriodSchema.parse('2025-03-01');
export const P2 = PayPeriodSchema.parse('2025-03-16');
export const P3 = PayPeriodSchema.parse('2025-04-01');
export const OWNER = newId(UserIdSchema);
const MAIN = newId(PlatformAccountIdSchema);
export const USD: ExchangeRate = {
  currency: 'USD',
  day: '2025-03-31',
  rateMicros: 920_000,
  source: 'test',
  fetchedAt: '2025-03-31T16:00:00.000Z',
};

export const member = (patch: Partial<MemberForPay> = {}): MemberForPay => ({
  id: newId(TeamMemberIdSchema),
  teamRole: 'chatter',
  status: 'active',
  joinedOn: '2025-01-01',
  rate: { rateBps: 2_000, teamShareBps: null },
  ...patch,
});

export const report = (
  who: MemberForPay,
  period: typeof P1,
  amountMinor: number,
  patch: Partial<ReportForPay> = {},
): ReportForPay => ({
  id: newId(ShiftReportIdSchema),
  memberId: who.id,
  platformAccountId: MAIN,
  period,
  amountMinor,
  currency: 'EUR' as const,
  vatBps: 0,
  platformFeeBps: 2_000,
  ...patch,
});

export const snapshot = (patch: Partial<PeriodSnapshot>): PeriodSnapshot => ({
  period: P2,
  closing: null,
  firstClosed: null,
  lastClosed: null,
  reports: [],
  registered: new Map(),
  members: [],
  bonuses: [],
  penalties: [],
  carryOvers: [],
  adjustments: [],
  bonusTierSets: [],
  collectiveGoals: [],
  minimumPayoutMinor: 1_500,
  latestRates: [],
  statements: [],
  ...patch,
});
