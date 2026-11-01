import {
  BonusIdSchema,
  CollectiveGoalIdSchema,
  CommissionStatementIdSchema,
  DomainError,
  newId,
  PayPeriodSchema,
  TeamMemberIdSchema,
  type Bonus,
  type CollectiveGoal,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import type { PayReader } from '../ports';
import {
  closePeriod,
  paysMember,
  periodIsEmpty,
  planPeriod,
  statementOf,
  type PeriodSnapshot,
} from '../recalculation';
import {
  assertValidates,
  periodBeforeFirstClosing,
  periodsOwedBefore,
  type StatementHead,
} from '../validation';

import { member, OWNER, P1, P2, P3, report, snapshot, USD } from './fixtures';

const codeOf = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'not a domain error';
  }
  return 'no error';
};

const goal = (tiers: CollectiveGoal['tiers']): CollectiveGoal => ({
  id: newId(CollectiveGoalIdSchema),
  period: P2,
  targetMinor: 10_000,
  tiers,
  createdBy: OWNER,
  createdAt: '2025-03-16T10:00:00.000Z',
});

describe('the closing of a period (ADR 0032)', () => {
  const theo = member();
  const lea = member();
  const late = report(theo, P1, 2_000);
  const own = report(theo, P2, 10_000, { currency: 'USD' });
  const hers = report(lea, P2, 5_000);
  const open = snapshot({
    period: P2,
    firstClosed: P1,
    lastClosed: P1,
    members: [theo, lea],
    reports: [late, own, hers],
    latestRates: [USD],
  });

  it('registers what the first open period counts and freezes its team net and rates', () => {
    const { closing, closed } = closePeriod(open);
    expect(closing.counted.map((one) => one.id).sort()).toEqual([late.id, own.id, hers.id].sort());
    // 100 $ at 0.92 then 20 % fee: 73.60 €; 20 € late: 16 €; Léa's 50 €: 40 €.
    expect(closing.teamNetMinor).toBe(7_360 + 1_600 + 4_000);
    expect(closing.exchangeRates).toEqual([USD]);
    expect(closed).toMatchObject({ lastClosed: P2, firstClosed: P1, closing: { teamNetMinor: 12_960 } });
    expect(closed.registered.get(late.id)).toBe(P2);
  });

  it('gives every statement the same hash on the closing as the draft computed while open', () => {
    const { closed } = closePeriod(open);
    expect(statementOf(closed, theo.id).inputsHash).toBe(statementOf(open, theo.id).inputsHash);
    // The job computing the closed period again writes nothing.
    const drafts = planPeriod(open);
    if (drafts.kind !== 'write') throw new Error('nothing written');
    const statements = drafts.inserts.map((draft) => ({
      id: newId(CommissionStatementIdSchema),
      memberId: draft.content.memberId,
      status: 'draft' as const,
      revision: 1,
      inputsHash: draft.inputsHash,
    }));
    expect(planPeriod({ ...closed, statements })).toMatchObject({ inserts: [], updates: [], unchanged: 2 });
  });

  it('changes a member’s hash when a colleague’s report changes the team’s net', () => {
    const more = { ...open, reports: [...open.reports, report(lea, P2, 1_000)] };
    expect(statementOf(more, theo.id).inputsHash).not.toBe(statementOf(open, theo.id).inputsHash);
  });

  it('closes the team’s first open period only, and never on a missing rate', () => {
    expect(() => closePeriod({ ...open, period: P3 })).toThrow('not the first open one');
    expect(() => closePeriod(closePeriod(open).closed)).toThrow('closed already');
    expect(codeOf(() => closePeriod({ ...open, latestRates: [] }))).toBe('exchange_rate_missing_conflict');
  });

  it('closes on a rate four days old, never five: Easter Monday on the 31st takes Thursday’s (ADR 0033)', () => {
    const thursday = { ...USD, day: '2025-03-27' };
    expect(closePeriod({ ...open, latestRates: [thursday] }).closing.exchangeRates).toEqual([thursday]);
    expect(codeOf(() => closePeriod({ ...open, latestRates: [{ ...USD, day: '2025-03-26' }] }))).toBe(
      'exchange_rate_missing_conflict',
    );
    // Only a closing freezes a rate: a draft of the period still computes on the latest one.
    expect(planPeriod({ ...open, latestRates: [{ ...USD, day: '2025-03-03' }] }).kind).toBe('write');
  });

  it('refuses to be the team’s first closing while an earlier report waits', () => {
    const first: PeriodSnapshot = { ...open, firstClosed: null, lastClosed: null };
    expect(() => closePeriod(first)).toThrow('An earlier period');
    const alone = closePeriod({ ...first, reports: [own, hers] });
    expect(alone.closed).toMatchObject({ firstClosed: P2, lastClosed: P2 });
  });
});

describe('what a period owes a member (ADR 0032)', () => {
  const theo = member();
  const idle = member();

  it('pays the member a report counts, or a collective bonus the team reached without them', () => {
    const period = snapshot({
      members: [theo, idle],
      reports: [report(theo, P2, 20_000)],
      collectiveGoals: [goal([{ reachedBps: 10_000, bonusMinor: 3_000 }])],
    });
    expect(paysMember(period, theo.id)).toBe(true);
    expect(paysMember(period, idle.id)).toBe(true);
    expect(paysMember({ ...period, collectiveGoals: [] }, idle.id)).toBe(false);
  });

  it('closes a period on the way only when it has nothing: no statement, no report, no entry', () => {
    const empty = snapshot({ members: [theo] });
    expect(periodIsEmpty(empty)).toBe(true);
    expect(periodIsEmpty({ ...empty, reports: [report(theo, P2, 0)] })).toBe(false);
    const bonus: Bonus = {
      id: newId(BonusIdSchema),
      memberId: theo.id,
      period: P2,
      amountMinor: 1_000,
      reason: 'Week-end tenu',
      createdBy: OWNER,
      createdAt: '2025-03-20T10:00:00.000Z',
      cancellation: null,
    };
    expect(periodIsEmpty({ ...empty, bonuses: [bonus] })).toBe(false);
    const statement = {
      id: newId(CommissionStatementIdSchema),
      memberId: theo.id,
      status: 'draft' as const,
      revision: 1,
      inputsHash: 'a',
    };
    expect(periodIsEmpty({ ...empty, statements: [statement] })).toBe(false);
  });
});

describe('who validates what (EQ-04)', () => {
  const theo = newId(TeamMemberIdSchema);
  const manager = newId(TeamMemberIdSchema);
  const head: StatementHead = { memberId: theo, period: P2, status: 'draft', revision: 3, inputsHash: 'a' };
  const ended = new Date('2025-04-01T00:00:00.000Z');
  const after = new Date('2025-04-02T00:00:00.000Z');
  const agency: PayReader = { scope: 'agency', memberId: manager };
  const validates = (patch: Partial<StatementHead>, reader: PayReader = agency) =>
    codeOf(() => {
      assertValidates({ ...head, ...patch }, reader, 3, ended, after);
    });

  it('lets the owner or an active manager validate a draft of an ended period at the revision shown', () => {
    expect(validates({})).toBe('no error');
    expect(validates({}, { scope: 'owner', memberId: null })).toBe('no error');
  });

  it('never lets anyone validate their own statement, nor a member who does not validate', () => {
    expect(validates({ memberId: manager })).toBe('payroll_own_forbidden');
    expect(validates({}, { scope: 'self', memberId: newId(TeamMemberIdSchema) })).toBe('payroll_forbidden');
  });

  it('refuses what is not a draft, another revision, and a period that has not ended', () => {
    expect(validates({ status: 'validated' })).toBe('commission_statement_status_conflict');
    expect(validates({ revision: 4 })).toBe('commission_statement_changed_conflict');
    expect(
      codeOf(() => {
        assertValidates(head, agency, 3, after, ended);
      }),
    ).toBe('commission_statement_open_conflict');
  });
});

describe('the periods a validation settles first (ADR 0032)', () => {
  it('starts the team’s closings at the earliest period that has anything to pay', () => {
    expect(periodBeforeFirstClosing(P3, [null, P2, P3, P1])).toBe(P1);
    expect(periodBeforeFirstClosing(P2, [null, P2, P3])).toBeNull();
  });

  it('checks the closed periods since the member’s last validated statement, not before they joined', () => {
    const P0 = PayPeriodSchema.parse('2025-02-16');
    expect(periodsOwedBefore(P3, { firstClosed: P0, lastValidated: null, joinedOn: '2025-01-10' })).toEqual([
      P0,
      P1,
      P2,
    ]);
    expect(periodsOwedBefore(P3, { firstClosed: P0, lastValidated: P1, joinedOn: '2025-01-10' })).toEqual([
      P2,
    ]);
    expect(periodsOwedBefore(P3, { firstClosed: P0, lastValidated: null, joinedOn: '2025-03-20' })).toEqual([
      P2,
    ]);
    expect(periodsOwedBefore(P3, { firstClosed: P3, lastValidated: P2, joinedOn: '2025-01-10' })).toEqual([]);
  });
});
