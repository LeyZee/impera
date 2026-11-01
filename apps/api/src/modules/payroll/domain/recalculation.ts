import {
  bonusTiersFor,
  canonicalExchangeRates,
  collectiveGoalFor,
  nextPayPeriod,
  payPeriodLastDay,
  penaltyApplies,
  type Bonus,
  type BonusTier,
  type BonusTierSet,
  type CarryOver,
  type CollectiveGoal,
  type CommissionStatementId,
  type CommissionStatementRules,
  type CommissionStatementStatus,
  type Currency,
  type ExchangeRate,
  type LateReport,
  type PayAdjustment,
  type PayPeriod,
  type Penalty,
  type PlatformAccountId,
  type ShiftReportId,
  type TeamMemberId,
  type TeamMemberStatus,
  type TeamRole,
} from '@nirvana/contracts';

import { canonicalJson, sha256Of } from './canonical';
import {
  computeCommissionStatements,
  type AccountEarnings,
  type CommissionStatement,
  type MemberPayInput,
  type PeriodStatements,
} from './commission-statements';
import { CommissionRateMissing } from './errors';
import { assertFreshRates } from './exchange-rates';

/**
 * The recalculation of a period's drafts (EQ-04, ADR 0032), pure: from what the job read in one transaction, the
 * statements to write. The whole period at once, since the collective goal and a manager's share hang on every member.
 *
 * Which reports a period counts is decided by the registry of counted reports, never by a date:
 * - a closed period counts exactly what its closing registered;
 * - an open period counts the validated reports no closing registered that were made for it, and, when it is the
 *   team's first open period, those made for an earlier period too (late reports, which keep their period's rules).
 * A period before the team's first closing is never computed again.
 */

/** A validated report as pay reads it: its amount, and its account's rules for the period it was made for. */
export interface ReportForPay {
  readonly id: ShiftReportId;
  readonly memberId: TeamMemberId;
  readonly platformAccountId: PlatformAccountId;
  readonly period: PayPeriod;
  readonly amountMinor: number;
  readonly currency: Currency;
  readonly vatBps: number;
  readonly platformFeeBps: number;
}

/** A member with the rate in force on the period's last day, `null` before any. */
export interface MemberForPay {
  readonly id: TeamMemberId;
  readonly teamRole: TeamRole;
  readonly status: TeamMemberStatus;
  readonly joinedOn: string;
  readonly rate: { readonly rateBps: number; readonly teamShareBps: number | null } | null;
}

/** The collective goal as the team reached it, as statements and closings keep it. */
export type CollectiveReached = PeriodStatements['collective'];

/** A statement already written for the period: what a recalculation compares with. */
interface StoredStatementHead {
  readonly id: CommissionStatementId;
  readonly memberId: TeamMemberId;
  readonly status: CommissionStatementStatus;
  readonly revision: number;
  readonly inputsHash: string;
}

/** Everything a period's statements are made of, read in the job's transaction under `payroll.close`. */
export interface PeriodSnapshot {
  readonly period: PayPeriod;
  /** The period's closing, `null` while it is open. */
  readonly closing: {
    readonly teamNetMinor: number;
    readonly collective: CollectiveReached;
    readonly exchangeRates: readonly ExchangeRate[];
  } | null;
  readonly firstClosed: PayPeriod | null;
  readonly lastClosed: PayPeriod | null;
  /** The validated reports made for the period or an earlier one. */
  readonly reports: readonly ReportForPay[];
  /** The period a closing counted each of those reports in, for those a closing registered. */
  readonly registered: ReadonlyMap<ShiftReportId, PayPeriod>;
  readonly members: readonly MemberForPay[];
  /** The period's bonuses, the penalties over it, the carry-overs into it and its adjustments, cancelled ones too. */
  readonly bonuses: readonly Bonus[];
  readonly penalties: readonly Penalty[];
  readonly carryOvers: readonly CarryOver[];
  readonly adjustments: readonly PayAdjustment[];
  /** Every tier set from the period or before, and the period's goals: the one in force is chosen here. */
  readonly bonusTierSets: readonly BonusTierSet[];
  readonly collectiveGoals: readonly CollectiveGoal[];
  readonly minimumPayoutMinor: number;
  /** For each currency, the latest rate read on the period's last day or before. */
  readonly latestRates: readonly ExchangeRate[];
  readonly statements: readonly StoredStatementHead[];
}

/** One account of a statement under one set of rules, with the reports it counts. */
interface StatementLineContent {
  readonly platformAccountId: PlatformAccountId;
  readonly currency: Currency;
  readonly vatBps: number;
  readonly platformFeeBps: number;
  readonly rateMicros: number;
  readonly grossMinor: number;
  readonly grossEurMinor: number;
  readonly exclVatMinor: number;
  readonly netMinor: number;
  readonly commissionMinor: number;
  readonly shiftReportIds: readonly ShiftReportId[];
  readonly lateReports: readonly LateReport[];
}

/** What a statement counted besides its reports, as they were when it was computed. */
interface CountedEntries {
  readonly bonuses: readonly Bonus[];
  readonly penalties: readonly Penalty[];
  readonly carryOversIn: readonly CarryOver[];
  readonly adjustments: readonly PayAdjustment[];
}

/** A statement's whole content, which `inputsHash` covers: everything but its id, status, revision and dates. */
export interface StatementContent {
  readonly memberId: TeamMemberId;
  readonly engineVersion: string;
  readonly lines: readonly StatementLineContent[];
  readonly netMinor: number;
  readonly commissionMinor: number;
  readonly teamShare: CommissionStatement['teamShare'];
  readonly tierBonus: BonusTier | null;
  readonly collectiveBonusMinor: number;
  readonly bonusesMinor: number;
  readonly penaltiesRequestedMinor: number;
  readonly penaltiesMinor: number;
  readonly carryOversInMinor: number;
  readonly adjustmentsMinor: number;
  readonly totalMinor: number;
  readonly carryOverOutMinor: number;
  readonly payableMinor: number;
  readonly teamNetMinor: number;
  readonly collective: CollectiveReached;
  readonly rules: CommissionStatementRules;
  readonly counted: CountedEntries;
}

export interface StatementDraft {
  readonly content: StatementContent;
  readonly inputsHash: string;
}

export type PeriodPlan =
  /** Before the team's first closing: closed for every member, never computed again. */
  | { readonly kind: 'never' }
  | {
      readonly kind: 'write';
      readonly inserts: readonly StatementDraft[];
      /** A draft's next revision. */
      readonly updates: readonly (StatementDraft & {
        readonly statementId: CommissionStatementId;
        readonly revision: number;
      })[];
      readonly unchanged: number;
      /** Validated or paid statements the period no longer gives: a bug to look at, never rewritten. */
      readonly drifted: readonly CommissionStatementId[];
    };

const ascending = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byId = <T extends { readonly id: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => ascending(a.id, b.id));

/** The team's first open period: the one after the last closed; `null` before any closing (none is late then). */
export function firstOpenPeriod(lastClosed: PayPeriod | null): PayPeriod | null {
  return lastClosed === null ? null : nextPayPeriod(lastClosed);
}

/** The reports `snapshot.period` counts (see above). */
export function reportsCounted(snapshot: PeriodSnapshot): ReportForPay[] {
  const { period } = snapshot;
  if (snapshot.closing !== null) {
    return snapshot.reports.filter((report) => snapshot.registered.get(report.id) === period);
  }
  const firstOpen = firstOpenPeriod(snapshot.lastClosed);
  return snapshot.reports.filter(
    (report) =>
      !snapshot.registered.has(report.id) &&
      (report.period === period || (firstOpen === period && report.period < period)),
  );
}

/**
 * The rates of the period: once closed, its closing's; while open, for each currency a counted report is in, the
 * latest read on the period's last day or before, never the rate of the day the job runs. A currency without one is
 * left out, and the engine refuses it (`exchange_rate_missing_conflict`): pay never guesses a rate.
 */
function periodRates(snapshot: PeriodSnapshot, counted: readonly ReportForPay[]): ExchangeRate[] {
  if (snapshot.closing !== null) return canonicalExchangeRates(snapshot.closing.exchangeRates);
  const used = new Set<string>(counted.map((report) => report.currency));
  return canonicalExchangeRates(snapshot.latestRates.filter((rate) => used.has(rate.currency)));
}

interface LineBuilder {
  readonly platformAccountId: PlatformAccountId;
  readonly earnings: AccountEarnings;
  grossMinor: number;
  readonly shiftReportIds: ShiftReportId[];
  readonly lateReports: LateReport[];
}

/** A member's reports, line by line: an account under one set of rules is one line, in one order. */
function linesOf(period: PayPeriod, reports: readonly ReportForPay[]): LineBuilder[] {
  const lines = new Map<string, LineBuilder>();
  for (const report of byId(reports)) {
    const key = [report.platformAccountId, report.currency, report.vatBps, report.platformFeeBps].join(' ');
    let line = lines.get(key);
    if (line === undefined) {
      line = {
        platformAccountId: report.platformAccountId,
        earnings: {
          platformAccountId: report.platformAccountId,
          currency: report.currency,
          grossMinor: 0,
          vatBps: report.vatBps,
          platformFeeBps: report.platformFeeBps,
        },
        grossMinor: 0,
        shiftReportIds: [],
        lateReports: [],
      };
      lines.set(key, line);
    }
    line.grossMinor += report.amountMinor;
    line.shiftReportIds.push(report.id);
    if (report.period < period) {
      line.lateReports.push({
        shiftReportId: report.id,
        period: report.period,
        grossMinor: report.amountMinor,
      });
    }
  }
  return [...lines.entries()].sort(([a], [b]) => ascending(a, b)).map(([, line]) => line);
}

/** What each member counts besides reports: bonuses not cancelled, penalties that apply, carry-overs, adjustments. */
function entriesOf(snapshot: PeriodSnapshot, memberId: TeamMemberId): CountedEntries {
  const mine = <T extends { readonly memberId: string; readonly id: string }>(items: readonly T[]): T[] =>
    byId(items.filter((item) => item.memberId === memberId));
  return {
    bonuses: mine(snapshot.bonuses).filter((bonus) => bonus.cancellation === null),
    penalties: mine(snapshot.penalties).filter((penalty) => penaltyApplies(penalty, snapshot.period)),
    carryOversIn: mine(snapshot.carryOvers),
    adjustments: mine(snapshot.adjustments),
  };
}

/** A member is in the collective goal's count: a chatter there on the period's last day, who has not left. */
const collectiveEligible = (member: MemberForPay, lastDay: string): boolean =>
  member.teamRole === 'chatter' && member.status !== 'left' && member.joinedOn <= lastDay;

const statementOfNothing = (memberId: TeamMemberId): CommissionStatement => ({
  memberId,
  lines: [],
  netMinor: 0,
  commissionMinor: 0,
  teamShare: null,
  tierBonus: null,
  collectiveBonusMinor: 0,
  manualBonusesMinor: 0,
  bonusesMinor: 0,
  penaltiesRequestedMinor: 0,
  penaltiesMinor: 0,
  carryOversInMinor: 0,
  adjustmentsMinor: 0,
  totalMinor: 0,
  carryOverOutMinor: 0,
  payableMinor: 0,
});

/**
 * The period's statements as the engine gives them, with each line's reports and the rules each one used. The
 * statements of the members with nothing are left out (`computeCommissionStatements`); `planPeriod` writes a zero
 * revision for a draft left with nothing, so that a statement never keeps what it no longer counts.
 */
function computePeriod(snapshot: PeriodSnapshot): {
  readonly computed: PeriodStatements;
  /** The members the period gives a statement to. */
  readonly given: readonly TeamMemberId[];
  readonly contentOf: (memberId: TeamMemberId) => StatementContent;
} {
  const { period } = snapshot;
  const lastDay = payPeriodLastDay(period);
  const counted = reportsCounted(snapshot);
  const rates = periodRates(snapshot, counted);
  const tierSet = bonusTiersFor(snapshot.bonusTierSets, period);
  const goal = collectiveGoalFor(snapshot.collectiveGoals, period);
  const memberIds = new Set(snapshot.members.map((member) => member.id));
  for (const report of counted) {
    if (!memberIds.has(report.memberId)) throw new Error(`Report ${report.id} has no member`);
  }

  const members = byId(snapshot.members).map((member) => {
    const lines = linesOf(
      period,
      counted.filter((report) => report.memberId === member.id),
    );
    return { member, lines, entries: entriesOf(snapshot, member.id) };
  });
  const input: MemberPayInput[] = members.map(({ member, lines, entries }) => ({
    memberId: member.id,
    teamRole: member.teamRole,
    // A member without a rate is refused below as soon as the period gives them a statement.
    commissionRateBps: member.rate?.rateBps ?? 0,
    teamShareBps: member.teamRole === 'manager' ? (member.rate?.teamShareBps ?? null) : null,
    collectiveEligible: collectiveEligible(member, lastDay),
    final: false,
    accounts: lines.map((line) => ({ ...line.earnings, grossMinor: line.grossMinor })),
    manualBonuses: entries.bonuses,
    penalties: entries.penalties.map((penalty) =>
      penalty.amount.kind === 'fixed'
        ? { id: penalty.id, kind: 'fixed' as const, amountMinor: penalty.amount.amountMinor }
        : { id: penalty.id, kind: 'percent' as const, bps: penalty.amount.bps },
    ),
    carryOversIn: entries.carryOversIn,
    adjustments: entries.adjustments,
  }));
  const tiers = tierSet?.tiers ?? [];
  const computed = computeCommissionStatements({
    rates,
    bonusTiers: tiers,
    collectiveGoal: goal === null ? null : { targetMinor: goal.targetMinor, tiers: goal.tiers },
    minimumPayoutMinor: snapshot.minimumPayoutMinor,
    members: input,
  });
  const missing = computed.statements
    .filter((statement) => members.find((one) => one.member.id === statement.memberId)?.member.rate === null)
    .map((statement) => statement.memberId);
  const [first, ...others] = missing;
  if (first !== undefined) throw new CommissionRateMissing(first, ...others);

  const contentOf = (memberId: TeamMemberId): StatementContent => {
    const found = members.find((one) => one.member.id === memberId);
    if (found === undefined) throw new Error(`Member ${memberId} is not in the period`);
    const statement =
      computed.statements.find((one) => one.memberId === memberId) ?? statementOfNothing(memberId);
    const { member, lines, entries } = found;
    return {
      memberId,
      engineVersion: computed.engineVersion,
      // The engine gives one line per account it was handed, in the same order.
      lines: statement.lines.map((line, index) => {
        const source = lines[index];
        if (source === undefined) throw new Error('A line without its reports');
        return {
          platformAccountId: source.platformAccountId,
          currency: line.currency,
          vatBps: source.earnings.vatBps,
          platformFeeBps: source.earnings.platformFeeBps,
          rateMicros: line.rateMicros,
          grossMinor: line.grossMinor,
          grossEurMinor: line.grossEurMinor,
          exclVatMinor: line.exclVatMinor,
          netMinor: line.netMinor,
          commissionMinor: line.commissionMinor,
          shiftReportIds: source.shiftReportIds,
          lateReports: source.lateReports,
        };
      }),
      netMinor: statement.netMinor,
      commissionMinor: statement.commissionMinor,
      teamShare: statement.teamShare,
      // The tier as the owner wrote it, with its label: the engine gives back the one it was handed.
      tierBonus:
        statement.tierBonus === null
          ? null
          : (tiers.find(
              (tier) =>
                tier.thresholdMinor === statement.tierBonus?.thresholdMinor &&
                tier.bonusMinor === statement.tierBonus.bonusMinor,
            ) ?? null),
      collectiveBonusMinor: statement.collectiveBonusMinor,
      bonusesMinor: statement.bonusesMinor,
      penaltiesRequestedMinor: statement.penaltiesRequestedMinor,
      penaltiesMinor: statement.penaltiesMinor,
      carryOversInMinor: statement.carryOversInMinor,
      adjustmentsMinor: statement.adjustmentsMinor,
      totalMinor: statement.totalMinor,
      carryOverOutMinor: statement.carryOverOutMinor,
      payableMinor: statement.payableMinor,
      teamNetMinor: computed.teamNetMinor,
      collective: computed.collective,
      rules: {
        commissionRateBps: member.rate?.rateBps ?? 0,
        teamShareBps: member.teamRole === 'manager' ? (member.rate?.teamShareBps ?? null) : null,
        bonusTiers: tiers,
        collectiveGoal: goal === null ? null : { targetMinor: goal.targetMinor, tiers: goal.tiers },
        minimumPayoutMinor: snapshot.minimumPayoutMinor,
        exchangeRates: rates,
        final: false,
      },
      // Empty for a member the engine left out: it leaves out only a member who counts nothing.
      counted: entries,
    };
  };
  const given = new Set(computed.statements.map((statement) => statement.memberId));
  return { computed, given: members.map(({ member }) => member.id).filter((id) => given.has(id)), contentOf };
}

/** `computePeriod`, and a closed period must give its closing's team net and collective goal again: it is the truth. */
function computedOnClosing(snapshot: PeriodSnapshot): ReturnType<typeof computePeriod> {
  const period = computePeriod(snapshot);
  const { closing } = snapshot;
  if (
    closing !== null &&
    (closing.teamNetMinor !== period.computed.teamNetMinor ||
      canonicalJson(closing.collective) !== canonicalJson(period.computed.collective))
  ) {
    throw new Error(`Period ${snapshot.period} no longer gives its closing's team net`);
  }
  return period;
}

/**
 * What to write for the period: a draft for each member it gives a statement to, the next revision of a draft whose
 * content changed (a draft left with nothing gets a zero revision), nothing for what did not change. A closed period
 * must give its closing's team net and collective goal again, or nothing is written: the closing is the truth.
 */
export function planPeriod(snapshot: PeriodSnapshot): PeriodPlan {
  if (snapshot.firstClosed !== null && snapshot.period < snapshot.firstClosed) return { kind: 'never' };
  const { given, contentOf } = computedOnClosing(snapshot);
  const stored = new Map(snapshot.statements.map((statement) => [statement.memberId, statement]));
  const memberIds = new Set<TeamMemberId>([...given, ...stored.keys()]);
  const inserts: StatementDraft[] = [];
  const updates: (StatementDraft & { statementId: CommissionStatementId; revision: number })[] = [];
  const drifted: CommissionStatementId[] = [];
  let unchanged = 0;
  for (const memberId of [...memberIds].sort(ascending)) {
    const content = contentOf(memberId);
    const draft = { content, inputsHash: sha256Of(content) };
    const statement = stored.get(memberId);
    if (statement === undefined) inserts.push(draft);
    else if (statement.inputsHash === draft.inputsHash) unchanged += 1;
    else if (statement.status === 'draft') {
      updates.push({ ...draft, statementId: statement.id, revision: statement.revision + 1 });
    } else drifted.push(statement.id);
  }
  return { kind: 'write', inserts, updates, unchanged, drifted };
}

/** What a period's closing freezes for the team (ADR 0032), with the reports its registry holds from then on. */
export interface ClosingPlan {
  readonly counted: readonly ReportForPay[];
  readonly teamNetMinor: number;
  readonly collective: CollectiveReached;
  readonly exchangeRates: readonly ExchangeRate[];
}

/**
 * The closing of `snapshot.period`, the team's first open period (ADR 0032): the reports it counts now go to its
 * registry; its team net, goal as reached and rates are frozen. With it, the snapshot as it reads once the closing is
 * written, on which every statement of the period is computed from then on. A rate or a commission rate missing is
 * refused here as in the recalculation, and so is a rate too old for the period's end (ADR 0033): a period never
 * closes on a guess.
 */
export function closePeriod(snapshot: PeriodSnapshot): {
  readonly closing: ClosingPlan;
  readonly closed: PeriodSnapshot;
} {
  const { period } = snapshot;
  if (snapshot.closing !== null) throw new Error(`Period ${period} is closed already`);
  const firstOpen = firstOpenPeriod(snapshot.lastClosed);
  if (firstOpen !== null && firstOpen !== period)
    throw new Error(`Period ${period} is not the first open one`);
  // Before any closing, a period counts its own reports: one still waiting from earlier would be left behind.
  if (
    firstOpen === null &&
    snapshot.reports.some((report) => report.period < period && !snapshot.registered.has(report.id))
  ) {
    throw new Error(`An earlier period than ${period} must close first`);
  }
  const counted = reportsCounted(snapshot);
  const { computed } = computePeriod(snapshot);
  const frozen = {
    teamNetMinor: computed.teamNetMinor,
    collective: computed.collective,
    exchangeRates: periodRates(snapshot, counted),
  };
  assertFreshRates(period, frozen.exchangeRates);
  const registered = new Map(snapshot.registered);
  for (const report of counted) registered.set(report.id, period);
  return {
    closing: { ...frozen, counted },
    closed: {
      ...snapshot,
      closing: frozen,
      registered,
      firstClosed: snapshot.firstClosed ?? period,
      lastClosed: period,
    },
  };
}

/** A member's statement of the period as it computes now, with its `inputsHash`: what a validation compares. */
export function statementOf(snapshot: PeriodSnapshot, memberId: TeamMemberId): StatementDraft {
  const content = computedOnClosing(snapshot).contentOf(memberId);
  return { content, inputsHash: sha256Of(content) };
}

/** Whether the period counts something for the member: a report, or a statement the engine gives them. */
export function paysMember(snapshot: PeriodSnapshot, memberId: TeamMemberId): boolean {
  return (
    reportsCounted(snapshot).some((report) => report.memberId === memberId) ||
    computedOnClosing(snapshot).given.includes(memberId)
  );
}

/**
 * Whether the period may close on the way to a later one (ADR 0032): no statement, no report counted, nothing the
 * engine gives anyone (a bonus, an adjustment, a carry-over in). Otherwise its statements are validated first.
 */
export function periodIsEmpty(snapshot: PeriodSnapshot): boolean {
  return (
    snapshot.statements.length === 0 &&
    reportsCounted(snapshot).length === 0 &&
    computedOnClosing(snapshot).given.length === 0
  );
}
