import { CARRY_OVER_RANK_MAX, positiveCarryRankIn, type Currency } from '@nirvana/contracts';

import { MissingExchangeRate } from './errors';
import { BPS, mulDivRound, RATE_SCALE } from './rounding';

/**
 * The commission statements of a period (EQ-04, ADR 0023 § Les règles d'Imperium, § Paie): pure, the same input gives
 * the same statements, without a clock or the database. Imperium's rules, unchanged:
 * - per account, on the account's total for the period (never sale by sale): gross → euros → excluding VAT → net of
 *   the platform's commission → the member's share, each step rounded to the cent and nowhere else;
 * - the highest individual bonus tier reached by the member's net, managers excluded;
 * - the collective goal on the team's net, managers' sales included, its bonus to every chatter it covers, managers
 *   excluded, sales or not;
 * - manual bonuses, managers included;
 * - fixed and percent penalties, the percent on the member's net, capped at the member's share plus bonuses;
 * - a manager's share of the team's net;
 * - what comes in from earlier periods (carry-overs, adjustments), and a total under the payout minimum carried over.
 * Three points differ from Imperium's code, as the ADRs and the task sheet decide: a penalty is capped at the member's
 * share plus bonuses, never at the net plus bonuses (a statement is never negative); a manager's share of the team's
 * net leaves out the manager's own net, already paid by the manager's commission; and a positive total is carried twice
 * at most, the third period paying it even under the minimum, so that its invoice is paid before its due date
 * (ADR 0038).
 */

/** Bumped with any change that could move a cent; a validated statement keeps the version that made it. */
export const ENGINE_VERSION = 'nirvana-2';

/** Euros for one unit of `currency`, in millionths, with where and when it was read. */
interface ExchangeRate {
  readonly currency: Currency;
  readonly rateMicros: number;
  readonly source: string;
  readonly day: string;
}

/** What one account brought a member in the period, in the account's currency, with the account's rules for it. */
export interface AccountEarnings {
  readonly platformAccountId: string;
  readonly currency: Currency;
  /** The validated reports counted in this period, late ones from earlier periods included. */
  readonly grossMinor: number;
  readonly vatBps: number;
  readonly platformFeeBps: number;
}

type PenaltyInput =
  | { readonly id: string; readonly kind: 'fixed'; readonly amountMinor: number }
  | { readonly id: string; readonly kind: 'percent'; readonly bps: number };

/** An amount that comes in from elsewhere: a manual bonus, a carry-over, an adjustment. */
interface AmountInput {
  readonly id: string;
  readonly amountMinor: number;
}

/** A carry-over into the period, with how many times in a row its amount has been carried (ADR 0038). */
interface CarryOverInput extends AmountInput {
  readonly rank: number;
}

export interface MemberPayInput {
  readonly memberId: string;
  readonly teamRole: 'chatter' | 'manager';
  readonly commissionRateBps: number;
  /** A manager's share of the team's net; `null` for a chatter. */
  readonly teamShareBps: number | null;
  /** A chatter the collective goal pays when reached (the application says who: not gone). */
  readonly collectiveEligible: boolean;
  /** The last statement of a member who leaves (EQ-14): no payout minimum, everything is paid. */
  readonly final: boolean;
  readonly accounts: readonly AccountEarnings[];
  readonly manualBonuses: readonly AmountInput[];
  readonly penalties: readonly PenaltyInput[];
  readonly carryOversIn: readonly CarryOverInput[];
  readonly adjustments: readonly AmountInput[];
}

interface BonusTier {
  /** The member's net, in euro cents, from which the bonus is due. */
  readonly thresholdMinor: number;
  readonly bonusMinor: number;
}

interface CollectiveTier {
  /** The share of the target the team's net reaches, in basis points (10 000 = the target). */
  readonly reachedBps: number;
  readonly bonusMinor: number;
}

interface CollectiveGoal {
  readonly targetMinor: number;
  readonly tiers: readonly CollectiveTier[];
}

export interface PeriodPayInput {
  readonly rates: readonly ExchangeRate[];
  readonly bonusTiers: readonly BonusTier[];
  readonly collectiveGoal: CollectiveGoal | null;
  readonly minimumPayoutMinor: number;
  readonly members: readonly MemberPayInput[];
}

/** One account of a statement, each step as Imperium showed it. */
interface CommissionStatementLine {
  readonly platformAccountId: string;
  readonly currency: Currency;
  readonly grossMinor: number;
  readonly rateMicros: number;
  readonly grossEurMinor: number;
  readonly exclVatMinor: number;
  readonly netMinor: number;
  readonly commissionMinor: number;
}

export interface CommissionStatement {
  readonly memberId: string;
  readonly lines: readonly CommissionStatementLine[];
  readonly netMinor: number;
  readonly commissionMinor: number;
  readonly teamShare: {
    readonly baseNetMinor: number;
    readonly bps: number;
    readonly amountMinor: number;
  } | null;
  readonly tierBonus: BonusTier | null;
  readonly collectiveBonusMinor: number;
  readonly manualBonusesMinor: number;
  readonly bonusesMinor: number;
  /** What the penalties asked for, and what the cap let through. */
  readonly penaltiesRequestedMinor: number;
  readonly penaltiesMinor: number;
  readonly carryOversInMinor: number;
  readonly adjustmentsMinor: number;
  readonly totalMinor: number;
  /**
   * Carried to the next period: a total under the payout minimum, unless already carried twice (ADR 0038), or below
   * zero.
   */
  readonly carryOverOutMinor: number;
  readonly payableMinor: number;
}

export interface PeriodStatements {
  readonly engineVersion: string;
  readonly teamNetMinor: number;
  /** The collective goal as the team reached it, `null` without a goal. */
  readonly collective: { readonly reachedBps: number; readonly tier: CollectiveTier | null } | null;
  readonly statements: readonly CommissionStatement[];
}

const sum = (amounts: readonly number[]): number => amounts.reduce((total, one) => total + one, 0);

function rateFor(rates: readonly ExchangeRate[], currency: Currency): number {
  if (currency === 'EUR') return RATE_SCALE;
  const rate = rates.find((one) => one.currency === currency);
  if (rate === undefined || rate.rateMicros <= 0) throw new MissingExchangeRate(currency);
  return rate.rateMicros;
}

function lineOf(
  account: AccountEarnings,
  rateMicros: number,
  commissionRateBps: number,
): CommissionStatementLine {
  const grossEurMinor = mulDivRound(account.grossMinor, rateMicros, RATE_SCALE);
  const exclVatMinor = mulDivRound(grossEurMinor, BPS, BPS + account.vatBps);
  const netMinor = mulDivRound(exclVatMinor, BPS - account.platformFeeBps, BPS);
  return {
    platformAccountId: account.platformAccountId,
    currency: account.currency,
    grossMinor: account.grossMinor,
    rateMicros,
    grossEurMinor,
    exclVatMinor,
    netMinor,
    commissionMinor: mulDivRound(netMinor, commissionRateBps, BPS),
  };
}

/** Of two tiers, the higher; on the same step, the larger bonus, so that the order they come in never matters. */
const higher = (step: number, bonus: number, than: { step: number; bonus: number } | null): boolean =>
  than === null || step > than.step || (step === than.step && bonus > than.bonus);

/** The highest tier `net` reaches, a threshold reached exactly included. */
function tierReached(tiers: readonly BonusTier[], netMinor: number): BonusTier | null {
  let found: BonusTier | null = null;
  for (const tier of tiers) {
    const best = found === null ? null : { step: found.thresholdMinor, bonus: found.bonusMinor };
    if (netMinor >= tier.thresholdMinor && higher(tier.thresholdMinor, tier.bonusMinor, best)) found = tier;
  }
  return found;
}

/** How far the team's net goes towards the target, and the highest tier it reaches, compared exactly. */
function collectiveReached(goal: CollectiveGoal, teamNetMinor: number): PeriodStatements['collective'] {
  if (goal.targetMinor <= 0) return { reachedBps: 0, tier: null };
  let tier: CollectiveTier | null = null;
  for (const one of goal.tiers) {
    const reached = BigInt(teamNetMinor) * BigInt(BPS) >= BigInt(goal.targetMinor) * BigInt(one.reachedBps);
    const best = tier === null ? null : { step: tier.reachedBps, bonus: tier.bonusMinor };
    if (reached && higher(one.reachedBps, one.bonusMinor, best)) tier = one;
  }
  // Said in basis points for the screen, rounded down: the comparison above is the exact one.
  const reachedBps =
    teamNetMinor <= 0 ? 0 : Number((BigInt(teamNetMinor) * BigInt(BPS)) / BigInt(goal.targetMinor));
  return { reachedBps, tier };
}

/** Has the member anything to say this period: a statement is made only then. */
function hasAnything(member: MemberPayInput, collectiveBonusMinor: number, teamShareMinor: number): boolean {
  return (
    member.accounts.length > 0 ||
    member.manualBonuses.length > 0 ||
    member.penalties.length > 0 ||
    member.carryOversIn.length > 0 ||
    member.adjustments.length > 0 ||
    collectiveBonusMinor !== 0 ||
    teamShareMinor !== 0
  );
}

/** The first value `key` gives twice, or `null`. */
function twice<T>(items: readonly T[], key: (item: T) => string): string | null {
  const seen = new Set<string>();
  for (const item of items) {
    const one = key(item);
    if (seen.has(one)) return one;
    seen.add(one);
  }
  return null;
}

/**
 * What the application must never hand the engine, since the answer would then hang on the order of the input: a
 * member twice (the team's net would count the member twice), two rates for one currency, or one account twice under
 * the same rules for a member (the account's total would be rounded in two pieces). The same account under other rules
 * (a late report from a period whose currency, VAT or platform fee differed) is a line of its own. A bug of the caller,
 * never a case of pay.
 */
function refuseDuplicates(input: PeriodPayInput): void {
  const member = twice(input.members, (one) => one.memberId);
  if (member !== null) throw new RangeError(`Member ${member} comes twice in one period`);
  const currency = twice(input.rates, (one) => one.currency);
  if (currency !== null) throw new RangeError(`Two exchange rates for ${currency}`);
  for (const one of input.members) {
    const account = twice(
      one.accounts,
      (earnings) =>
        `${earnings.platformAccountId} ${earnings.currency} ${String(earnings.vatBps)} ${String(earnings.platformFeeBps)}`,
    );
    if (account !== null) throw new RangeError(`Account ${account} comes twice for member ${one.memberId}`);
  }
}

export function computeCommissionStatements(input: PeriodPayInput): PeriodStatements {
  refuseDuplicates(input);
  const lines = new Map(
    input.members.map((member) => [
      member.memberId,
      member.accounts.map((account) =>
        lineOf(account, rateFor(input.rates, account.currency), member.commissionRateBps),
      ),
    ]),
  );
  const netOf = (memberId: string): number => sum((lines.get(memberId) ?? []).map((line) => line.netMinor));
  // Every member's net, managers' sales included, as Imperium's `total_net_ht_equipe`.
  const teamNetMinor = sum(input.members.map((member) => netOf(member.memberId)));
  const collective =
    input.collectiveGoal === null ? null : collectiveReached(input.collectiveGoal, teamNetMinor);

  const statements: CommissionStatement[] = [];
  for (const member of input.members) {
    const memberLines = lines.get(member.memberId) ?? [];
    const netMinor = netOf(member.memberId);
    const commissionMinor = sum(memberLines.map((line) => line.commissionMinor));
    const manager = member.teamRole === 'manager';

    // The others' net: the manager's own is paid by the manager's commission. Refunds never make it a debt.
    const othersNetMinor = Math.max(0, teamNetMinor - netMinor);
    const teamShare =
      manager && member.teamShareBps !== null
        ? {
            baseNetMinor: othersNetMinor,
            bps: member.teamShareBps,
            amountMinor: mulDivRound(othersNetMinor, member.teamShareBps, BPS),
          }
        : null;
    const tierBonus = manager ? null : tierReached(input.bonusTiers, netMinor);
    const collectiveBonusMinor =
      !manager && member.collectiveEligible ? (collective?.tier?.bonusMinor ?? 0) : 0;
    if (!hasAnything(member, collectiveBonusMinor, teamShare?.amountMinor ?? 0)) continue;

    const manualBonusesMinor = sum(member.manualBonuses.map((bonus) => bonus.amountMinor));
    const bonusesMinor = (tierBonus?.bonusMinor ?? 0) + collectiveBonusMinor + manualBonusesMinor;

    const fixedMinor = sum(member.penalties.map((one) => (one.kind === 'fixed' ? one.amountMinor : 0)));
    const percentBps = sum(member.penalties.map((one) => (one.kind === 'percent' ? one.bps : 0)));
    // A percent of the net, as Imperium's `pourcentage`; a net below zero (refunds) never lowers a penalty.
    const penaltiesRequestedMinor = fixedMinor + mulDivRound(Math.max(0, netMinor), percentBps, BPS);
    const shareMinor = commissionMinor + (teamShare?.amountMinor ?? 0);
    const capMinor = Math.max(0, shareMinor + bonusesMinor);
    const penaltiesMinor = Math.max(0, Math.min(penaltiesRequestedMinor, capMinor));

    const carryOversInMinor = sum(member.carryOversIn.map((one) => one.amountMinor));
    const adjustmentsMinor = sum(member.adjustments.map((one) => one.amountMinor));
    const totalMinor = shareMinor + bonusesMinor - penaltiesMinor + carryOversInMinor + adjustmentsMinor;
    const carryOverOutMinor =
      totalMinor < 0
        ? totalMinor
        : !member.final &&
            totalMinor > 0 &&
            totalMinor < input.minimumPayoutMinor &&
            positiveCarryRankIn(member.carryOversIn) < CARRY_OVER_RANK_MAX
          ? totalMinor
          : 0;

    statements.push({
      memberId: member.memberId,
      lines: memberLines,
      netMinor,
      commissionMinor,
      teamShare,
      tierBonus,
      collectiveBonusMinor,
      manualBonusesMinor,
      bonusesMinor,
      penaltiesRequestedMinor,
      penaltiesMinor,
      carryOversInMinor,
      adjustmentsMinor,
      totalMinor,
      carryOverOutMinor,
      payableMinor: totalMinor - carryOverOutMinor,
    });
  }
  return { engineVersion: ENGINE_VERSION, teamNetMinor, collective, statements };
}
