import {
  BonusIdSchema,
  BonusTierSetIdSchema,
  CommissionStatementIdSchema,
  DomainError,
  newId,
  PenaltyIdSchema,
  type Bonus,
  type Penalty,
  type ShiftReportId,
} from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { periodsToRecompute } from '../../application/recalculation';
import { canonicalJson, sha256Of } from '../canonical';
import {
  planPeriod,
  reportsCounted,
  type MemberForPay,
  type PeriodPlan,
  type StatementDraft,
} from '../recalculation';

import { member, OWNER, P1, P2, P3, report, snapshot, USD } from './fixtures';

const written = (plan: PeriodPlan) => {
  if (plan.kind !== 'write') throw new Error('nothing written');
  return plan;
};

/** The draft of `who` in a plan, new or a next revision. */
const draftOf = (plan: PeriodPlan, who: MemberForPay): StatementDraft => {
  const { inserts, updates } = written(plan);
  const found = [...inserts, ...updates].find((draft) => draft.content.memberId === who.id);
  if (found === undefined) throw new Error('no draft');
  return found;
};

/** The statements as the store would keep them after `plan`, all drafts. */
const storedAfter = (plan: PeriodPlan) =>
  written(plan).inserts.map((draft) => ({
    id: newId(CommissionStatementIdSchema),
    memberId: draft.content.memberId,
    status: 'draft' as const,
    revision: 1,
    inputsHash: draft.inputsHash,
  }));

const ids = (reports: readonly { readonly id: ShiftReportId }[]) => reports.map((one) => one.id).sort();

describe('the reports a period counts (ADR 0032)', () => {
  const theo = member();
  const counted = report(theo, P1, 10_000);
  const late = report(theo, P1, 2_000);
  const own = report(theo, P2, 5_000);
  const later = report(theo, P3, 7_000);
  const reports = [counted, late, own, later];
  const registered = new Map([[counted.id, P1]]);

  it('counts in the team’s first open period its own reports and the late ones no closing counted', () => {
    const open = snapshot({ period: P2, lastClosed: P1, firstClosed: P1, reports, registered });
    expect(ids(reportsCounted(open))).toEqual(ids([late, own]));
  });

  it('counts in a later open period its own reports only: a late report goes to the first open one', () => {
    const later3 = snapshot({ period: P3, lastClosed: P1, firstClosed: P1, reports, registered });
    expect(ids(reportsCounted(later3))).toEqual(ids([later]));
  });

  it('counts in a closed period exactly what its closing registered, whatever else was validated since', () => {
    const closed = snapshot({
      period: P1,
      closing: { teamNetMinor: 0, collective: null, exchangeRates: [] },
      lastClosed: P1,
      firstClosed: P1,
      reports,
      registered,
    });
    expect(ids(reportsCounted(closed))).toEqual(ids([counted]));
  });

  it('counts every report in its own period before any closing: none is late yet', () => {
    expect(ids(reportsCounted(snapshot({ period: P2, reports })))).toEqual(ids([own]));
    expect(ids(reportsCounted(snapshot({ period: P1, reports, registered: new Map() })))).toEqual(
      ids([counted, late]),
    );
  });
});

describe('the drafts a recalculation writes (EQ-04)', () => {
  it('writes a draft for each member the period pays, then nothing on a replay', () => {
    const theo = member();
    const lea = member();
    const idle = member();
    const reports = [report(theo, P2, 10_000), report(lea, P2, 4_000)];
    const first = planPeriod(snapshot({ members: [theo, lea, idle], reports }));
    expect(
      written(first)
        .inserts.map((draft) => draft.content.memberId)
        .sort(),
    ).toEqual([theo.id, lea.id].sort());
    // 100 € gross, no VAT, 20 % fee: 80 € net; 20 % of it is 16 €. Léa: 32 € net, the team 112 €.
    expect(draftOf(first, theo).content).toMatchObject({
      netMinor: 8_000,
      commissionMinor: 1_600,
      teamNetMinor: 11_200,
    });
    const replay = planPeriod(
      snapshot({
        members: [idle, lea, theo],
        reports: [...reports].reverse(),
        statements: storedAfter(first),
      }),
    );
    expect(written(replay)).toMatchObject({ inserts: [], updates: [], unchanged: 2 });
  });

  it('takes the next revision of a draft whose inputs changed, and a zero revision for one left with nothing', () => {
    const theo = member();
    const lea = member();
    const first = planPeriod(
      snapshot({ members: [theo, lea], reports: [report(theo, P2, 10_000), report(lea, P2, 4_000)] }),
    );
    const statements = storedAfter(first);
    const next = planPeriod(
      snapshot({ members: [theo, lea], reports: [report(theo, P2, 12_000)], statements }),
    );
    const { updates } = written(next);
    expect(updates.map((update) => [update.content.memberId, update.revision]).sort()).toEqual(
      [
        [theo.id, 2],
        [lea.id, 2],
      ].sort(),
    );
    expect(draftOf(next, lea).content).toMatchObject({
      lines: [],
      netMinor: 0,
      totalMinor: 0,
      payableMinor: 0,
    });
    expect(draftOf(next, theo).content.netMinor).toBe(9_600);
  });

  it('gives a late report its own period’s rules, on a line of its own that says where it came from', () => {
    const theo = member();
    const late = report(theo, P1, 2_000, { vatBps: 2_000 });
    const own = report(theo, P2, 5_000);
    const plan = planPeriod(
      snapshot({ period: P2, lastClosed: P1, firstClosed: P1, members: [theo], reports: [late, own] }),
    );
    const { lines } = draftOf(plan, theo).content;
    expect(lines.map((line) => [line.vatBps, line.shiftReportIds, line.lateReports])).toEqual([
      [0, [own.id], []],
      [2_000, [late.id], [{ shiftReportId: late.id, period: P1, grossMinor: 2_000 }]],
    ]);
  });

  it('converts at the latest rate of the period’s last day, and refuses a currency without one', () => {
    const theo = member();
    const sale = report(theo, P2, 10_000, { currency: 'USD' });
    const plan = planPeriod(snapshot({ members: [theo], reports: [sale], latestRates: [USD] }));
    expect(draftOf(plan, theo).content.rules.exchangeRates).toEqual([USD]);
    // 100 $ at 0.92: 92 € gross, 73.60 € net.
    expect(draftOf(plan, theo).content.netMinor).toBe(7_360);
    // Only the currencies the period was paid in.
    const euros = planPeriod(
      snapshot({ members: [theo], reports: [report(theo, P2, 100)], latestRates: [USD] }),
    );
    expect(draftOf(euros, theo).content.rules.exchangeRates).toEqual([]);
    expect(() => planPeriod(snapshot({ members: [theo], reports: [sale] }))).toThrow(DomainError);
  });

  it('refuses to pay a member without a commission rate in force, never guessing one', () => {
    const theo = member({ rate: null });
    let code = '';
    try {
      planPeriod(snapshot({ members: [theo], reports: [report(theo, P2, 1_000)] }));
    } catch (error) {
      code = error instanceof DomainError ? error.code : 'other';
    }
    expect(code).toBe('commission_rate_missing_conflict');
    // Nothing to pay, nothing refused.
    expect(written(planPeriod(snapshot({ members: [theo] }))).inserts).toEqual([]);
  });

  it('counts the bonuses that stand and the penalties that apply, and keeps the tier with its label', () => {
    const theo = member();
    const bonus = (cancelled: boolean): Bonus => ({
      id: newId(BonusIdSchema),
      memberId: theo.id,
      period: P2,
      amountMinor: 1_000,
      reason: 'Week-end tenu',
      createdBy: OWNER,
      createdAt: '2025-03-20T10:00:00.000Z',
      cancellation: cancelled ? { cancelledAt: '2025-03-21T10:00:00.000Z', cancelledBy: OWNER } : null,
    });
    const penalty = (cancelledFrom: typeof P1 | null): Penalty => ({
      id: newId(PenaltyIdSchema),
      memberId: theo.id,
      fromPeriod: P1,
      toPeriod: P3,
      amount: { kind: 'fixed', amountMinor: 500 },
      reason: 'Shift manqué',
      createdBy: OWNER,
      createdAt: '2025-03-01T10:00:00.000Z',
      cancellation:
        cancelledFrom === null
          ? null
          : { cancelledAt: '2025-03-20T10:00:00.000Z', cancelledBy: OWNER, cancelledFrom },
    });
    const standing = bonus(false);
    const applying = penalty(P3);
    const plan = planPeriod(
      snapshot({
        members: [theo],
        reports: [report(theo, P2, 10_000)],
        bonuses: [standing, bonus(true)],
        penalties: [applying, penalty(P2)],
        bonusTierSets: [
          {
            id: newId(BonusTierSetIdSchema),
            fromPeriod: P1,
            tiers: [{ thresholdMinor: 5_000, bonusMinor: 2_000, label: 'Bronze' }],
            createdBy: OWNER,
            createdAt: '2025-03-01T10:00:00.000Z',
          },
        ],
      }),
    );
    const { content } = draftOf(plan, theo);
    expect(content.counted.bonuses).toEqual([standing]);
    expect(content.counted.penalties).toEqual([applying]);
    expect(content.tierBonus).toEqual({ thresholdMinor: 5_000, bonusMinor: 2_000, label: 'Bronze' });
    // 16 € + 20 € tier + 10 € bonus − 5 € penalty.
    expect(content.totalMinor).toBe(4_100);
  });

  it('gives the same hash whatever order the period was read in', () => {
    const theo = member();
    const lea = member();
    const reports = [report(theo, P2, 1_000), report(theo, P2, 2_000), report(lea, P2, 3_000)];
    const one = planPeriod(snapshot({ members: [theo, lea], reports }));
    const other = planPeriod(snapshot({ members: [lea, theo], reports: [...reports].reverse() }));
    expect(draftOf(other, theo).inputsHash).toBe(draftOf(one, theo).inputsHash);
    expect(draftOf(other, theo).content.lines[0]?.shiftReportIds).toEqual(ids(reports.slice(0, 2)));
  });
});

describe('a closed period (ADR 0032)', () => {
  const theo = member();
  const sale = report(theo, P1, 10_000);
  const closed = (teamNetMinor: number) =>
    snapshot({
      period: P1,
      closing: { teamNetMinor, collective: null, exchangeRates: [] },
      firstClosed: P1,
      lastClosed: P1,
      members: [theo],
      reports: [sale],
      registered: new Map([[sale.id, P1]]),
    });

  it('is computed on its closing, and nothing is written when it no longer gives the closing’s team net', () => {
    expect(draftOf(planPeriod(closed(8_000)), theo).content.teamNetMinor).toBe(8_000);
    expect(() => planPeriod(closed(8_001))).toThrow(/closing/u);
  });

  it('never rewrites a validated statement, and names one that drifted', () => {
    const id = newId(CommissionStatementIdSchema);
    const statement = {
      id,
      memberId: theo.id,
      status: 'validated' as const,
      revision: 1,
      inputsHash: 'f'.repeat(64),
    };
    expect(written(planPeriod({ ...closed(8_000), statements: [statement] }))).toMatchObject({
      inserts: [],
      updates: [],
      drifted: [id],
    });
  });

  it('is never computed again before the team’s first closing', () => {
    expect(planPeriod(snapshot({ period: P1, firstClosed: P2, lastClosed: P2 }))).toEqual({ kind: 'never' });
  });
});

describe('the hourly run (EQ-04)', () => {
  it('computes from the team’s first open period, or the earliest waiting report, up to the current one', () => {
    expect(periodsToRecompute({ current: P3, lastClosed: P1, earliestUncounted: P1 })).toEqual([P2, P3]);
    expect(periodsToRecompute({ current: P3, lastClosed: null, earliestUncounted: P1 })).toEqual([
      P1,
      P2,
      P3,
    ]);
    expect(periodsToRecompute({ current: P3, lastClosed: null, earliestUncounted: null })).toEqual([P3]);
  });
});

describe('the canonical text of a statement', () => {
  it('does not depend on the order its keys were written in', () => {
    expect(canonicalJson({ b: 1, a: { d: [2, 1], c: null } })).toBe('{"a":{"c":null,"d":[2,1]},"b":1}');
    expect(sha256Of({ a: 1, b: 2 })).toBe(sha256Of({ b: 2, a: 1 }));
    expect(sha256Of({ a: 1 })).toMatch(/^[0-9a-f]{64}$/u);
  });
});
