import { z } from 'zod';

import { pageOf } from './conversations';
import {
  BonusIdSchema,
  BonusTierSetIdSchema,
  CarryOverIdSchema,
  CollectiveGoalIdSchema,
  CommissionStatementIdSchema,
  PayAdjustmentIdSchema,
  PenaltyIdSchema,
  PayoutMinimumIdSchema,
  PlatformAccountIdSchema,
  ShiftReportIdSchema,
  TeamMemberIdSchema,
  UserIdSchema,
} from './ids';
import { CurrencySchema } from './money';
import { PayPeriodSchema, type PayPeriod } from './pay-periods';
import { TimezoneSchema } from './persona';
import { BasisPointsSchema } from './team';
import { CalendarDaySchema } from './team-members';

/**
 * Pay (EQ-04, ADR 0023 § Les règles d'Imperium, § Paie), under `/v1/payroll`. Each member has one commission statement
 * per pay period, computed by the `payroll` module's pure engine from the period's validated reports, the member's
 * rates, bonuses, penalties, carry-overs and adjustments, with Imperium's rules: `draft` while its inputs change, then
 * `validated` (frozen), then `paid`. Integers only, in the database as here: amounts in euro cents, rates in basis
 * points, exchange rates in millionths (ADR 0011). A statement copies every rule and rate it used and the engine's
 * version, so that computing it again gives the same cent.
 *
 * Who: the owner and an active manager (scope `agency`) read every statement and write bonuses, penalties and
 * adjustments, never for themselves; they validate statements, never their own. Only the owner marks a statement paid,
 * sets the bonus tiers, the collective goals and the payout minimum. A member (scope `self`) reads their own statements,
 * bonuses, penalties and adjustments, and the tiers and goals every member works towards.
 *
 * A period closes for the whole team at the first validation of one of its statements (ADR 0032): the reports it
 * counts, its exchange rates and the team's net are frozen then, for every statement of the period. Periods close in
 * order. A report validated after its period's closing counts on the team's first open period, with the period it
 * came from. A member's period is closed once the member's statement of it, or of a later period, is validated:
 * bonuses, penalties and adjustments for a closed period land on the member's first open period.
 */

/** The engine that computes statements, copied into each one (`nirvana-1` for the first). */
export const PayEngineVersionSchema = z.string().regex(/^nirvana-\d+$/);

/** The highest amount entered by hand (a bonus, a penalty, an adjustment), in euro cents: 50 000 €, a slip guard. */
export const PAY_AMOUNT_MAX_MINOR = 5_000_000;

/** The highest threshold or target, in euro cents of net: 1 000 000 €. */
export const PAY_TARGET_MAX_MINOR = 100_000_000;

/** The payout minimum until the owner sets one: 15 €, Imperium's `paie_report_seuil`. */
export const DEFAULT_MINIMUM_PAYOUT_MINOR = 1_500;

/**
 * How many times in a row a positive amount may be carried over (ADR 0038): the third fortnight pays it, even under the
 * payout minimum, so that its invoice is paid before its due date.
 */
export const CARRY_OVER_RANK_MAX = 2;

/** The longest payout delay the owner may announce to the team (PAIE-32), in business days. */
export const PAYOUT_DELAY_MAX_BUSINESS_DAYS = 30;

/** Exchange rates in millionths of a euro for one unit of the currency: 1 000 000 is one euro. */
export const RATE_MICROS_SCALE = 1_000_000;

const PositiveAmountSchema = z.number().int().min(1).max(PAY_AMOUNT_MAX_MINOR);
const SignedAmountSchema = z
  .number()
  .int()
  .min(-PAY_AMOUNT_MAX_MINOR)
  .max(PAY_AMOUNT_MAX_MINOR)
  .refine((amount) => amount !== 0, 'Un montant de 0 ne change rien');
/** An amount a statement computes: any integer, its sign meaningful. */
const MinorSchema = z.number().int();

/** Why a bonus, a penalty or an adjustment: said to the member, never a fan's data. */
const PayReasonSchema = z.string().trim().min(1).max(500);

/** A SHA-256 in lower-case hexadecimal. */
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

const sameValues = (values: readonly number[]): boolean => new Set(values).size !== values.length;

export const COMMISSION_STATEMENT_STATUSES = ['draft', 'validated', 'paid'] as const;
export const CommissionStatementStatusSchema = z.enum(COMMISSION_STATEMENT_STATUSES);
export type CommissionStatementStatus = z.infer<typeof CommissionStatementStatusSchema>;

/**
 * A period as pay wrote it the first time it needed it: its first and last instants in the agency's zone of that day.
 * The next period starts where this one ends, so that nothing falls between two periods nor in both, even after the
 * zone changes.
 */
export const PayPeriodWindowSchema = z.object({
  period: PayPeriodSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: TimezoneSchema,
});
export type PayPeriodWindow = z.infer<typeof PayPeriodWindowSchema>;

/** A currency pay converts to euros. */
export const ForeignCurrencySchema = CurrencySchema.exclude(['EUR']);
export type ForeignCurrency = z.infer<typeof ForeignCurrencySchema>;

/**
 * A rate as pay read it (`exchange_rates`, global, written by the rate job only): euros for one unit of `currency`, in
 * millionths, the day it is for, and where it was read. Never a rate written in the code.
 */
export const ExchangeRateSchema = z.object({
  currency: ForeignCurrencySchema,
  day: CalendarDaySchema,
  rateMicros: z.number().int().min(1),
  source: z.string().min(1).max(100),
  fetchedAt: z.iso.datetime(),
});
export type ExchangeRate = z.infer<typeof ExchangeRateSchema>;

/**
 * The rates a statement copies, in their one order: by currency. The database compares a statement's rates with its
 * period's closing as written (ADR 0032), so that every writer goes through this function.
 */
export function canonicalExchangeRates<R extends { readonly currency: string }>(rates: readonly R[]): R[] {
  return [...rates].sort((a, b) => (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

/**
 * `GET /v1/payroll/exchange-rates` (owner and an active manager): the latest rate of each currency, `null` before the
 * first one is read. A member reads the rate of their own statement's lines (`rateMicros`), never this one.
 */
export const ExchangeRatesSchema = z.object({ usd: ExchangeRateSchema.nullable() });
export type ExchangeRates = z.infer<typeof ExchangeRatesSchema>;

const MinimumPayoutMinorSchema = z.number().int().min(0).max(PAY_AMOUNT_MAX_MINOR);

/** Business days between a statement's validation and its payout, as the owner announces it (PAIE-32). */
const PayoutDelaySchema = z.number().int().min(1).max(PAYOUT_DELAY_MAX_BUSINESS_DAYS);

/**
 * `GET /v1/payroll/settings` (the whole team reads it), and `settings` of a period's view. `minimumPayoutMinor`: the
 * minimum in force for the period read (today's for `GET /settings`): below it, a statement's total is carried over.
 * `nextMinimum`: the first change set after that period, `null` without one (PAIE-22: a minimum changes only from a
 * period that has not begun). `payoutDelayBusinessDays`: the usual delay between validation and payout that Commissions
 * shows each member (PAIE-32), `null` while the owner announces none; never written in the code.
 */
export const PayrollSettingsSchema = z.object({
  minimumPayoutMinor: MinimumPayoutMinorSchema,
  nextMinimum: z
    .object({ fromPeriod: PayPeriodSchema, minimumPayoutMinor: MinimumPayoutMinorSchema })
    .nullable(),
  payoutDelayBusinessDays: PayoutDelaySchema.nullable(),
});
export type PayrollSettings = z.infer<typeof PayrollSettingsSchema>;

/** `PUT /v1/payroll/settings` (owner): the payout delay announced to the team (PAIE-32); `null` announces none. */
export const UpdatePayrollSettingsBodySchema = z.object({
  payoutDelayBusinessDays: PayoutDelaySchema.nullable(),
});
export type UpdatePayrollSettingsBody = z.infer<typeof UpdatePayrollSettingsBodySchema>;

/**
 * The payout minimum from `fromPeriod` on (PAIE-22), for the whole team. Added only, from a period that has not begun
 * (`pay_rule_started_invalid`): the drafts of a period already worked keep theirs. Before any, the minimum of
 * `payroll_settings` (or `DEFAULT_MINIMUM_PAYOUT_MINOR`) is in force.
 */
export const PayoutMinimumSchema = z.object({
  id: PayoutMinimumIdSchema,
  fromPeriod: PayPeriodSchema,
  minimumPayoutMinor: MinimumPayoutMinorSchema,
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});
export type PayoutMinimum = z.infer<typeof PayoutMinimumSchema>;

/** `POST /v1/payroll/payout-minimums` (owner) → 201 `PayoutMinimumSchema`, 200 for the same `id` and values. */
export const CreatePayoutMinimumBodySchema = z.object({
  id: PayoutMinimumIdSchema,
  fromPeriod: PayPeriodSchema,
  minimumPayoutMinor: MinimumPayoutMinorSchema,
});
export type CreatePayoutMinimumBody = z.infer<typeof CreatePayoutMinimumBodySchema>;

/** The minimum in force for `period`: the latest `fromPeriod` at or before it, the newest of that period; `null` before. */
export function payoutMinimumFor<M extends Pick<PayoutMinimum, 'id' | 'fromPeriod' | 'createdAt'>>(
  minimums: readonly M[],
  period: PayPeriod,
): M | null {
  let found: M | null = null;
  for (const one of minimums) {
    if (one.fromPeriod > period) continue;
    if (found === null || newer(one, found, (minimum) => minimum.fromPeriod)) found = one;
  }
  return found;
}

/** The first change of minimum after `period`: the earliest `fromPeriod` after it, the newest of that period. */
export function nextPayoutMinimum<M extends Pick<PayoutMinimum, 'id' | 'fromPeriod' | 'createdAt'>>(
  minimums: readonly M[],
  period: PayPeriod,
): M | null {
  let found: M | null = null;
  for (const one of minimums) {
    if (one.fromPeriod <= period) continue;
    if (
      found === null ||
      one.fromPeriod < found.fromPeriod ||
      (one.fromPeriod === found.fromPeriod && newer(one, found, (minimum) => minimum.fromPeriod))
    )
      found = one;
  }
  return found;
}

/**
 * One individual tier: a member's net of `thresholdMinor` or more in the period brings `bonusMinor`. Never at 0: a
 * tier at 0 would pay a member who has only a penalty, and not one who has nothing.
 */
export const BonusTierSchema = z.object({
  thresholdMinor: z.number().int().min(1).max(PAY_TARGET_MAX_MINOR),
  bonusMinor: PositiveAmountSchema,
  label: z.string().trim().min(1).max(60),
});
export type BonusTier = z.infer<typeof BonusTierSchema>;

const BonusTiersSchema = z
  .array(BonusTierSchema)
  .max(20)
  .refine((tiers) => !sameValues(tiers.map((tier) => tier.thresholdMinor)), 'Deux paliers au même seuil');

/**
 * The individual tiers from `fromPeriod` on, every member but managers (the highest reached counts). Added only: a new
 * set replaces the one in force from its period, which no validated statement may have reached yet
 * (`pay_period_closed_conflict`). An empty set means no tier from then on.
 */
export const BonusTierSetSchema = z.object({
  id: BonusTierSetIdSchema,
  fromPeriod: PayPeriodSchema,
  tiers: BonusTiersSchema,
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});
export type BonusTierSet = z.infer<typeof BonusTierSetSchema>;

/** `POST /v1/payroll/bonus-tiers` (owner) → 201 `BonusTierSetSchema`, 200 for the same `id` and values. */
export const CreateBonusTierSetBodySchema = z.object({
  id: BonusTierSetIdSchema,
  fromPeriod: PayPeriodSchema,
  tiers: BonusTiersSchema,
});
export type CreateBonusTierSetBody = z.infer<typeof CreateBonusTierSetBodySchema>;

/** The set in force for `period`: the latest `fromPeriod` at or before it, the newest of that period; `null` before. */
export function bonusTiersFor<S extends Pick<BonusTierSet, 'id' | 'fromPeriod' | 'createdAt'>>(
  sets: readonly S[],
  period: PayPeriod,
): S | null {
  let found: S | null = null;
  for (const one of sets) {
    if (one.fromPeriod > period) continue;
    if (found === null || newer(one, found, (set) => set.fromPeriod)) found = one;
  }
  return found;
}

/** Is `a` after `b`: by `step` first, then by when it was made, then by id (ids made later sort later, UUIDv7). */
function newer<T extends { readonly id: string; readonly createdAt: string }>(
  a: T,
  b: T,
  step: (one: T) => string,
): boolean {
  if (step(a) !== step(b)) return step(a) > step(b);
  if (a.createdAt !== b.createdAt) return a.createdAt > b.createdAt;
  return a.id > b.id;
}

/** One collective tier: the team's net at `reachedBps` of the target or more (10 000 = the target) brings each chatter `bonusMinor`. */
export const CollectiveTierSchema = z.object({
  reachedBps: z.number().int().min(1).max(100_000),
  bonusMinor: PositiveAmountSchema,
});
export type CollectiveTier = z.infer<typeof CollectiveTierSchema>;

const CollectiveTiersSchema = z
  .array(CollectiveTierSchema)
  .max(10)
  .refine((tiers) => !sameValues(tiers.map((tier) => tier.reachedBps)), 'Deux paliers au même pourcentage');

/**
 * The team's goal for `period`: its net, managers' sales included, against `targetMinor`; the highest tier reached
 * pays each chatter it covers, sales or not, never a manager. Added only: the newest for the period is in force, until
 * a statement of the period is validated (`pay_period_closed_conflict`). No tier means no goal for the period.
 */
export const CollectiveGoalSchema = z.object({
  id: CollectiveGoalIdSchema,
  period: PayPeriodSchema,
  targetMinor: z.number().int().min(1).max(PAY_TARGET_MAX_MINOR),
  tiers: CollectiveTiersSchema,
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});
export type CollectiveGoal = z.infer<typeof CollectiveGoalSchema>;

/** `POST /v1/payroll/collective-goals` (owner) → 201 `CollectiveGoalSchema`, 200 for the same `id` and values. */
export const CreateCollectiveGoalBodySchema = z.object({
  id: CollectiveGoalIdSchema,
  period: PayPeriodSchema,
  targetMinor: z.number().int().min(1).max(PAY_TARGET_MAX_MINOR),
  tiers: CollectiveTiersSchema,
});
export type CreateCollectiveGoalBody = z.infer<typeof CreateCollectiveGoalBodySchema>;

/** The goal in force for `period`: its newest, `null` without one or when the newest has no tier. */
export function collectiveGoalFor<G extends Pick<CollectiveGoal, 'id' | 'period' | 'createdAt' | 'tiers'>>(
  goals: readonly G[],
  period: PayPeriod,
): G | null {
  let found: G | null = null;
  for (const one of goals) {
    if (one.period !== period) continue;
    if (found === null || newer(one, found, (goal) => goal.period)) found = one;
  }
  return found === null || found.tiers.length === 0 ? null : found;
}

/** Who wrote a bonus or a penalty off, and when; `null` while it counts. */
const CancellationSchema = z.object({ cancelledAt: z.iso.datetime(), cancelledBy: UserIdSchema });

/**
 * A manual bonus for `memberId` in `period`, managers included. Cancelled rather than deleted, while the member's
 * period is open (`pay_period_closed_conflict` after).
 */
export const BonusSchema = z.object({
  id: BonusIdSchema,
  memberId: TeamMemberIdSchema,
  period: PayPeriodSchema,
  amountMinor: PositiveAmountSchema,
  reason: PayReasonSchema,
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
  cancellation: CancellationSchema.nullable(),
});
export type Bonus = z.infer<typeof BonusSchema>;

/**
 * `POST /v1/payroll/bonuses` (owner, active manager, never for themselves) → 201 `BonusSchema`, 200 for the same `id`
 * and values. `period` is today's, an earlier one or the next one: further on answers 400 `request_invalid` (a slip of
 * the year). `POST /v1/payroll/bonuses/:id/cancel` → 200 `BonusSchema`, the same answer when already cancelled.
 */
export const CreateBonusBodySchema = z.object({
  id: BonusIdSchema,
  memberId: TeamMemberIdSchema,
  period: PayPeriodSchema,
  amountMinor: PositiveAmountSchema,
  reason: PayReasonSchema,
});
export type CreateBonusBody = z.infer<typeof CreateBonusBodySchema>;

export const PENALTY_KINDS = ['fixed', 'percent'] as const;
export const PenaltyKindSchema = z.enum(PENALTY_KINDS);
export type PenaltyKind = z.infer<typeof PenaltyKindSchema>;

/** What a penalty takes: a fixed amount, or a percent of the member's net, in basis points. */
const PenaltyAmountSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fixed'), amountMinor: PositiveAmountSchema }),
  z.object({
    kind: z.literal('percent'),
    bps: BasisPointsSchema.refine((bps) => bps > 0, 'Un pourcentage de 0'),
  }),
]);

const PenaltyPeriodsShape = { fromPeriod: PayPeriodSchema, toPeriod: PayPeriodSchema };
const inOrder = (penalty: { readonly fromPeriod: PayPeriod; readonly toPeriod: PayPeriod }): boolean =>
  penalty.toPeriod >= penalty.fromPeriod;

/**
 * A penalty on `memberId`, in each period from `fromPeriod` to `toPeriod` included (Imperium's malus over several
 * periods), capped in each statement at the member's share plus bonuses. A cancellation stops it from `cancelledFrom`
 * on, the member's first open period: the periods already validated keep it.
 */
const PenaltyShape = {
  id: PenaltyIdSchema,
  memberId: TeamMemberIdSchema,
  ...PenaltyPeriodsShape,
  amount: PenaltyAmountSchema,
  reason: PayReasonSchema,
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
  cancellation: CancellationSchema.extend({ cancelledFrom: PayPeriodSchema }).nullable(),
};
const PENALTY_ORDER = { message: 'La dernière quinzaine vient après la première', path: ['toPeriod'] };
export const PenaltySchema = z.object(PenaltyShape).refine(inOrder, PENALTY_ORDER);
export type Penalty = z.infer<typeof PenaltySchema>;

/** Does `penalty` cover `period`: one of the periods it was made for, cancelled since or not. */
export const penaltyCovers = (
  penalty: Pick<Penalty, 'fromPeriod' | 'toPeriod'>,
  period: PayPeriod,
): boolean => penalty.fromPeriod <= period && period <= penalty.toPeriod;

/** Does `penalty` count in `period`: it covers it, and no cancellation stopped it there or before. */
export function penaltyApplies(
  penalty: Pick<Penalty, 'fromPeriod' | 'toPeriod'> & {
    readonly cancellation: { readonly cancelledFrom: PayPeriod } | null;
  },
  period: PayPeriod,
): boolean {
  if (!penaltyCovers(penalty, period)) return false;
  return penalty.cancellation === null || period < penalty.cancellation.cancelledFrom;
}

/**
 * `POST /v1/payroll/penalties` (owner, active manager, never for themselves) → 201 `PenaltySchema`, 200 for the same
 * `id` and values; `fromPeriod` is open for the member. `POST /v1/payroll/penalties/:id/cancel` → 200 `PenaltySchema`,
 * the same answer when already cancelled, `penalty_cancel_conflict` when every period it covers is closed.
 */
export const CreatePenaltyBodySchema = z
  .object({
    id: PenaltyIdSchema,
    memberId: TeamMemberIdSchema,
    ...PenaltyPeriodsShape,
    amount: PenaltyAmountSchema,
    reason: PayReasonSchema,
  })
  .refine(inOrder, { message: 'La dernière quinzaine vient après la première', path: ['toPeriod'] });
export type CreatePenaltyBody = z.infer<typeof CreatePenaltyBodySchema>;

/**
 * A correction of a validated or paid statement (`correctsStatementId`), or of something pay could not see: an amount
 * to add or take off, on the member's first open period when it is made (`period`). Added only, never changed.
 */
export const PayAdjustmentSchema = z.object({
  id: PayAdjustmentIdSchema,
  memberId: TeamMemberIdSchema,
  period: PayPeriodSchema,
  amountMinor: SignedAmountSchema,
  reason: PayReasonSchema,
  correctsStatementId: CommissionStatementIdSchema.nullable(),
  createdBy: UserIdSchema,
  createdAt: z.iso.datetime(),
});
export type PayAdjustment = z.infer<typeof PayAdjustmentSchema>;

/**
 * `POST /v1/payroll/adjustments` (owner, active manager, never for themselves) → 201 `PayAdjustmentSchema`, 200 for
 * the same `id` and values. The server chooses the period: the member's first open one, where their next statement
 * to validate is (their earliest open draft, or else the team's first period not closed).
 */
export const CreatePayAdjustmentBodySchema = z.object({
  id: PayAdjustmentIdSchema,
  memberId: TeamMemberIdSchema,
  amountMinor: SignedAmountSchema,
  reason: PayReasonSchema,
  correctsStatementId: CommissionStatementIdSchema.nullable().default(null),
});
export type CreatePayAdjustmentBody = z.input<typeof CreatePayAdjustmentBodySchema>;

/** Who made or cancelled an entry: the agency's to read, `null` for a member (`withMember`'s scope `self`). */
const EntryAuthorSchema = UserIdSchema.nullable();
const EntryCancellationSchema = z.object({ cancelledAt: z.iso.datetime(), cancelledBy: EntryAuthorSchema });

/**
 * A bonus, a penalty or an adjustment as its reader reads it, in a statement or in the period's entries: the owner and
 * an active manager read who made and cancelled it; a member reads its reason, amount and state, its authors at
 * `null`, never the agency's side.
 */
export const BonusViewSchema = BonusSchema.extend({
  createdBy: EntryAuthorSchema,
  cancellation: EntryCancellationSchema.nullable(),
});
export type BonusView = z.infer<typeof BonusViewSchema>;
export const PenaltyViewSchema = z
  .object({
    ...PenaltyShape,
    createdBy: EntryAuthorSchema,
    cancellation: EntryCancellationSchema.extend({ cancelledFrom: PayPeriodSchema }).nullable(),
  })
  .refine(inOrder, PENALTY_ORDER);
export type PenaltyView = z.infer<typeof PenaltyViewSchema>;
export const PayAdjustmentViewSchema = PayAdjustmentSchema.extend({ createdBy: EntryAuthorSchema });
export type PayAdjustmentView = z.infer<typeof PayAdjustmentViewSchema>;

/**
 * What a validated statement carried instead of paying it (`statementId`): a total under the payout minimum, or below
 * zero. Written by the validation, one per member and period it comes from, never changed; the next period's
 * statement counts it.
 */
export const CarryOverSchema = z
  .object({
    id: CarryOverIdSchema,
    memberId: TeamMemberIdSchema,
    fromPeriod: PayPeriodSchema,
    toPeriod: PayPeriodSchema,
    amountMinor: MinorSchema.refine((amount) => amount !== 0, 'Un report de 0'),
    /**
     * How many times in a row a positive amount has been carried, this carry-over included: 1, then 2 (ADR 0038); always 1
     * for a negative one. A statement counted before the rank existed read 1: a first carry-over.
     */
    rank: z.number().int().min(1).max(CARRY_OVER_RANK_MAX).default(1),
    statementId: CommissionStatementIdSchema,
    createdAt: z.iso.datetime(),
  })
  .refine((carry) => carry.rank === 1 || carry.amountMinor > 0, 'Un report négatif est toujours au rang 1');
export type CarryOver = z.infer<typeof CarryOverSchema>;

/** What the rank rule reads of a carry-over. */
interface RankedCarryOver {
  readonly amountMinor: number;
  readonly rank: number;
}

/** How many times in a row the positive amount coming into a period has been carried (ADR 0038); 0 when none comes in. */
export function positiveCarryRankIn(carryOversIn: readonly RankedCarryOver[]): number {
  return Math.max(0, ...carryOversIn.filter((one) => one.amountMinor > 0).map((one) => one.rank));
}

/**
 * The rank of what a statement carries over (ADR 0038): a positive amount following a positive carry-over takes its
 * rank plus one, any other carry-over rank 1, a negative one included, which starts the count again. The base checks
 * the same rule (`keep_carry_over`, migration 0043) and refuses a third time.
 */
export function carryOverRank(carryOversIn: readonly RankedCarryOver[], carryOverOutMinor: number): number {
  return carryOverOutMinor > 0 ? positiveCarryRankIn(carryOversIn) + 1 : 1;
}

/** A report a statement counts although it was made for an earlier period, closed for the team when it came. */
export const LateReportSchema = z.object({
  shiftReportId: ShiftReportIdSchema,
  period: PayPeriodSchema,
  grossMinor: MinorSchema,
});
export type LateReport = z.infer<typeof LateReportSchema>;

/**
 * One account of a statement, each step as Imperium showed it, under the account's rules for the period: the gross of
 * the validated reports (`shiftReportIds`, late ones included) in the account's currency, then in euros at
 * `rateMicros`, excluding VAT, net of the platform's fee, and the member's commission. Each step rounded to the cent,
 * half away from zero, and nowhere else.
 */
export const CommissionStatementLineSchema = z.object({
  platformAccountId: PlatformAccountIdSchema,
  currency: CurrencySchema,
  vatBps: BasisPointsSchema,
  platformFeeBps: BasisPointsSchema,
  rateMicros: z.number().int().min(1),
  grossMinor: MinorSchema,
  grossEurMinor: MinorSchema,
  exclVatMinor: MinorSchema,
  netMinor: MinorSchema,
  commissionMinor: MinorSchema,
  shiftReportIds: z.array(ShiftReportIdSchema),
  lateReports: z.array(LateReportSchema),
});
export type CommissionStatementLine = z.infer<typeof CommissionStatementLineSchema>;

/**
 * The rules a statement used, copied into it: the member's rate and team share in force on the period's last day,
 * the tiers, the goal, the minimum, the rates (for each currency, the latest read on the period's last day or before;
 * once the period is closed, its closing's), and whether it is the member's final statement (EQ-14: no minimum,
 * everything paid).
 */
export const CommissionStatementRulesSchema = z.object({
  commissionRateBps: BasisPointsSchema,
  teamShareBps: BasisPointsSchema.nullable(),
  bonusTiers: z.array(BonusTierSchema),
  collectiveGoal: z
    .object({ targetMinor: z.number().int().min(1), tiers: z.array(CollectiveTierSchema) })
    .nullable(),
  minimumPayoutMinor: z.number().int().min(0),
  exchangeRates: z.array(ExchangeRateSchema),
  final: z.boolean(),
});
export type CommissionStatementRules = z.infer<typeof CommissionStatementRulesSchema>;

/**
 * How far the team got toward the period's collective goal, in basis points, and the tier it reached (`null` below
 * the first).
 */
export const CollectiveReachedSchema = z.object({
  reachedBps: z.number().int().min(0),
  tier: CollectiveTierSchema.nullable(),
});

/**
 * How the owner paid a statement (ADR 0023 § Factures): a closed list the screen says in French. The chatters are paid
 * by WorldRemit only (Charles, 28/10/2026); a new method is a migration of the check on
 * `commission_statements.payment_method`, never free text.
 */
export const PAYMENT_METHODS = ['worldremit'] as const;
export const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

/** The longest transfer reference pay keeps. */
export const PAYMENT_REFERENCE_MAX = 100;

/**
 * How long an IBAN is in each country that issues them: ISO 13616's registry, and the national formats banks issue
 * outside it (UEMOA and CEMAC zones, a few others), each with its check digits.
 */
const IBAN_LENGTHS: ReadonlyMap<string, number> = new Map(
  (
    'AD24 AE23 AL28 AO25 AT20 AZ28 BA20 BE16 BF28 BG22 BH22 BI27 BJ28 BR29 BY28 CF27 CG27 CH21 CI28 ' +
    'CM27 CR22 CV25 CY28 CZ24 DE22 DJ27 DK18 DO28 DZ26 EE20 EG29 ES24 FI18 FK18 FO18 FR27 GA27 GB22 ' +
    'GE22 GI23 GL18 GQ27 GR27 GT28 GW25 HN28 HR21 HU28 IE22 IL23 IQ23 IR26 IS26 IT27 JO30 KM27 KW30 ' +
    'KZ20 LB28 LC32 LI21 LT20 LU20 LV21 LY25 MA28 MC27 MD24 ME22 MG27 MK19 ML28 MN20 MR27 MT31 MU30 ' +
    'MZ25 NE28 NI28 NL18 NO15 OM23 PK24 PL28 PS29 PT25 QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24 SI19 ' +
    'SK24 SM27 SN28 SO23 ST25 SV28 TD27 TG28 TL23 TN24 TR26 UA29 VA22 VG24 XK20 YE30'
  )
    .split(' ')
    .map((entry): [string, number] => [entry.slice(0, 2), Number(entry.slice(2))]),
);

/** ISO 7064 mod 97-10: the first four characters moved to the end, a letter read as 10 to 35, one at a time. */
function ibanCheckPasses(candidate: string): boolean {
  let remainder = 0;
  for (const char of candidate.slice(4) + candidate.slice(0, 4)) {
    const value = Number.parseInt(char, 36);
    remainder = (remainder * (value < 10 ? 10 : 100) + value) % 97;
  }
  return remainder === 1;
}

/**
 * Whether `text` holds an IBAN anywhere: kept to its letters and digits in capitals, some window of it starts with a
 * country code and two digits, has that country's exact length, and passes mod 97. « Transfert FR76 3000… » is one.
 */
export function containsIban(text: string): boolean {
  const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  for (let start = 0; start + 4 <= compact.length; start += 1) {
    const length = IBAN_LENGTHS.get(compact.slice(start, start + 2));
    if (length === undefined || start + length > compact.length) continue;
    const candidate = compact.slice(start, start + length);
    if (/^[A-Z]{2}\d{2}/.test(candidate) && ibanCheckPasses(candidate)) return true;
  }
  return false;
}

/**
 * The transfer's reference as the bank or the service shows it, to find it again; never an IBAN (refused, here for the
 * screen and the server alike: the repository is public and real payments go through this column) nor an account
 * number (said by the screen).
 */
const PaymentReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(PAYMENT_REFERENCE_MAX)
  .refine((reference) => !containsIban(reference), 'Une référence de transfert, jamais un IBAN');

/** What was sent, in euro cents: never nothing. */
const SentMinorSchema = z.number().int().min(1).max(PAY_AMOUNT_MAX_MINOR);

/** A statement's payment: the day of the transfer, how, its reference when there is one, and what was sent. */
export const StatementPaymentSchema = z.object({
  paidOn: CalendarDaySchema,
  method: PaymentMethodSchema,
  reference: PaymentReferenceSchema.nullable(),
  sentMinor: SentMinorSchema,
});
export type StatementPayment = z.infer<typeof StatementPaymentSchema>;

/**
 * A member's statement for a period. `revision` grows by one each time a recalculation changes it; a validation names
 * the revision it shows, and the server computes it again under its locks, on the period's closing: another revision,
 * or other inputs (`inputsHash`, which covers the reports counted, the rates, the period's team net, collective tier
 * and a manager's base too), answer `commission_statement_changed_conflict`, never a statement the reader did not see.
 *
 * `team` is `null` for a member reading their own statement when the period has no collective goal. With one, the
 * member reads how far the team got (`collective`), never the team's net itself: `netMinor` is `null` for them (the
 * agency's figure; default until Charles decides otherwise). Its bonuses, penalties and adjustments are read as in
 * the period's entries: a member reads none of their authors.
 *
 * `teamShare` is a manager's share of the others' net. `penaltiesRequestedMinor` is what the penalties asked for,
 * `penaltiesMinor` what the cap let through. `totalMinor` = commission + team share + bonuses − penalties +
 * carry-overs in + adjustments; `carryOverOutMinor` is carried to the next period (a total under the minimum, or below
 * zero) and `payableMinor` = total − carried, never below zero.
 */
export const CommissionStatementSchema = z.object({
  id: CommissionStatementIdSchema,
  memberId: TeamMemberIdSchema,
  window: PayPeriodWindowSchema,
  status: CommissionStatementStatusSchema,
  revision: z.number().int().min(1),
  engineVersion: PayEngineVersionSchema,
  inputsHash: Sha256Schema,
  lines: z.array(CommissionStatementLineSchema),
  netMinor: MinorSchema,
  commissionMinor: MinorSchema,
  teamShare: z
    .object({ baseNetMinor: MinorSchema, bps: BasisPointsSchema, amountMinor: MinorSchema })
    .nullable(),
  tierBonus: BonusTierSchema.nullable(),
  collectiveBonusMinor: MinorSchema,
  bonuses: z.array(BonusViewSchema),
  penalties: z.array(PenaltyViewSchema),
  carryOversIn: z.array(CarryOverSchema),
  adjustments: z.array(PayAdjustmentViewSchema),
  bonusesMinor: MinorSchema,
  penaltiesRequestedMinor: MinorSchema,
  penaltiesMinor: MinorSchema,
  carryOversInMinor: MinorSchema,
  adjustmentsMinor: MinorSchema,
  totalMinor: MinorSchema,
  carryOverOutMinor: MinorSchema,
  payableMinor: z.number().int().min(0),
  /** The period's team, as the engine saw it: its net (`null` for a member), and the collective goal as reached. */
  team: z
    .object({ netMinor: MinorSchema.nullable(), collective: CollectiveReachedSchema.nullable() })
    .nullable(),
  rules: CommissionStatementRulesSchema,
  /** Whether the reader may validate it now (`mayValidateStatement`): never one's own. */
  canValidate: z.boolean(),
  computedAt: z.iso.datetime(),
  validatedAt: z.iso.datetime().nullable(),
  validatedBy: UserIdSchema.nullable(),
  paidAt: z.iso.datetime().nullable(),
  paidBy: UserIdSchema.nullable(),
  /** How the owner paid it, `null` until it is paid. */
  payment: StatementPaymentSchema.nullable(),
});
export type CommissionStatement = z.infer<typeof CommissionStatementSchema>;

/**
 * A period closed for the team (ADR 0032): when, and for the owner and an active manager by whom and on which rates.
 * A member reads of a closing only its date, as in the list of periods: `closedBy` and `exchangeRates` are `null` for
 * them. Its team net and collective goal as reached are those of each of its statements (`CommissionStatement.team`).
 */
export const PayPeriodClosingSchema = z.object({
  period: PayPeriodSchema,
  exchangeRates: z.array(ExchangeRateSchema).nullable(),
  closedBy: UserIdSchema.nullable(),
  closedAt: z.iso.datetime(),
});
export type PayPeriodClosing = z.infer<typeof PayPeriodClosingSchema>;

/** The business reasons pay records when it cannot compute a period (EQ-04, recette du 28/10, Équipe G1). */
export const PAY_PERIOD_BLOCK_CODES = [
  'commission_rate_missing_conflict',
  'exchange_rate_missing_conflict',
] as const;
export type PayPeriodBlockCode = (typeof PAY_PERIOD_BLOCK_CODES)[number];

/**
 * Why pay could not compute a period at its last try, and since when the same reason holds: its statements are those
 * of the last computation that passed, out of date. `commission_rate_missing_conflict`: members it pays have no
 * commission rate in force on the period's last day (`memberIds`, all of them; for a member, only themselves, so
 * possibly none). `exchange_rate_missing_conflict`: no usable rate for `currency`. Gone at the next computation that
 * passes: the ECB rate read, or the data corrected for a member without a rate. Only what is shown: a validation computes
 * the period again under `payroll.close` and refuses with the same code.
 */
export const PayPeriodBlockSchema = z.discriminatedUnion('code', [
  z.object({
    code: z.literal('commission_rate_missing_conflict'),
    memberIds: z.array(TeamMemberIdSchema),
    since: z.iso.datetime(),
  }),
  z.object({
    code: z.literal('exchange_rate_missing_conflict'),
    currency: ForeignCurrencySchema,
    since: z.iso.datetime(),
  }),
]);
export type PayPeriodBlock = z.infer<typeof PayPeriodBlockSchema>;

/**
 * `GET /v1/payroll/periods/:period`: the period's statements (every member's for the agency, one's own for a member),
 * with what made them. `window` is `null` while pay has not written the period; `ended` says whether it can be
 * validated (a period validates once it has ended in the agency's zone); `closing` is `null` until its first
 * validation closes it for the team. `beforeFirstClosing` says the period comes before the team's first closing: it is
 * closed for good without a closing of its own and has no statement, and a report of it counts late on the team's
 * first open period (ADR 0032). `blocked` says pay could not compute the period at its last try
 * (`PayPeriodBlockSchema`): its statements are out of date until it can. Absent (an older server) reads as `null`.
 */
export const PayrollPeriodSchema = z.object({
  period: PayPeriodSchema,
  window: PayPeriodWindowSchema.nullable(),
  ended: z.boolean(),
  closing: PayPeriodClosingSchema.nullable(),
  beforeFirstClosing: z.boolean(),
  blocked: PayPeriodBlockSchema.nullable(),
  statements: z.array(CommissionStatementSchema),
  bonusTiers: BonusTierSetSchema.nullable(),
  collectiveGoal: CollectiveGoalSchema.nullable(),
  settings: PayrollSettingsSchema,
});
export type PayrollPeriod = z.infer<typeof PayrollPeriodSchema>;

/** A sum of a period's statements in euro cents: a `bigint` in SQL, read only within JavaScript's exact integers. */
const PeriodSumSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const StatementCountSchema = z.number().int().min(0);

/**
 * A period of `GET /v1/payroll/periods` (EQ-05): its window, whether it has ended, when the team closed it, and the
 * statements its reader reads there (`withMember`), counted by status and summed. The team's for the owner and an
 * active manager; one's own for a member, never the team's. `closedBy` is `null` while the period is open, and always
 * for a member, who reads of a closing only its date (never the team's net nor its rates).
 *
 * Only a validation makes an amount owed or carried: `payableMinor` sums every statement, those still to validate
 * included (what the period would pay); `validatedPayableMinor` sums the validated and paid ones only (what is owed),
 * so that « reste à envoyer » is `validatedPayableMinor − paidMinor` on every screen. `carried` counts the validated
 * and paid statements whose total was carried over (below the minimum payout, or below zero), never a statement still
 * to validate, and `carriedMinor` sums what they carried with its sign: positive under the minimum, negative below
 * zero. For one member it is what goes over to the next period; over the team it is a net of both kinds, never an
 * amount to show as owed or taken back. `paidMinor` is what was sent. `blocked` says pay could not compute the period at
 * its last try, as in `PayrollPeriodSchema`: its sums are out of date.
 */
export const PayPeriodSummarySchema = z.object({
  window: PayPeriodWindowSchema,
  ended: z.boolean(),
  closedAt: z.iso.datetime().nullable(),
  closedBy: UserIdSchema.nullable(),
  blocked: PayPeriodBlockSchema.nullable(),
  statements: z.object({
    draft: StatementCountSchema,
    validated: StatementCountSchema,
    paid: StatementCountSchema,
    carried: StatementCountSchema,
  }),
  netMinor: PeriodSumSchema,
  payableMinor: PeriodSumSchema,
  validatedPayableMinor: PeriodSumSchema,
  carriedMinor: PeriodSumSchema,
  paidMinor: PeriodSumSchema,
});
export type PayPeriodSummary = z.infer<typeof PayPeriodSummarySchema>;

/**
 * `GET /v1/payroll/periods?limit=&cursor=` (`PageQuerySchema`) → 200: the periods where the reader reads at least one
 * statement, the most recent first (api.md § Pagination). 400 `cursor_invalid`, a cursor this route did not give.
 */
export const PayPeriodPageSchema = pageOf(PayPeriodSummarySchema);
export type PayPeriodPage = z.infer<typeof PayPeriodPageSchema>;

/** The most entries of each kind `GET /v1/payroll/entries` gives for one period: beyond, it refuses rather than cut. */
export const PAYROLL_ENTRIES_MAX = 500;

/**
 * `GET /v1/payroll/entries?period=` (EQ-05) → 200: the bonuses of `period`, the penalties that cover it
 * (`penaltyCovers`: one counts there per `penaltyApplies`, otherwise it shows struck through) and its adjustments,
 * cancelled ones included, the newest first. Every member's for the owner and an active manager, one's own for a
 * member, who reads an entry's reason, amount and state but not its authors (`createdBy` and `cancelledBy` are `null`).
 * A period nobody wrote in gives empty lists. 422 `payroll_entries_too_many_unprocessable` beyond `PAYROLL_ENTRIES_MAX`
 * of a kind: never a list cut short.
 */
export const PayrollEntriesSchema = z.object({
  period: PayPeriodSchema,
  bonuses: z.array(BonusViewSchema).max(PAYROLL_ENTRIES_MAX),
  penalties: z.array(PenaltyViewSchema).max(PAYROLL_ENTRIES_MAX),
  adjustments: z.array(PayAdjustmentViewSchema).max(PAYROLL_ENTRIES_MAX),
});
export type PayrollEntries = z.infer<typeof PayrollEntriesSchema>;

/**
 * `POST /v1/payroll/statements/:id/validate` (owner, active manager, never one's own) → 200 `CommissionStatementSchema`.
 * The period has ended, and the member's earlier statements are validated (`commission_statement_order_conflict`
 * otherwise, with `details.statementId`, or `details.period` when pay has not written that statement yet). The first
 * validation of a period closes it for the team (ADR 0032): the team's earlier periods are closed (an empty one is
 * closed on the way, `pay_period_order_conflict` otherwise), each period to close has been written by pay
 * (`pay_period_not_computed_conflict`), no report of the period waits for review
 * (`pay_period_reports_pending_conflict`), and the closing reads every report it counts
 * (`pay_period_reports_unread_conflict`). The statement is computed on the closing, the carry-over is written, and the
 * statement is frozen: the database refuses any later change but `validated` → `paid`.
 */
export const ValidateCommissionStatementBodySchema = z.object({ revision: z.number().int().min(1) });
export type ValidateCommissionStatementBody = z.infer<typeof ValidateCommissionStatementBodySchema>;

/**
 * `POST /v1/payroll/statements/:id/pay` (owner only) → 200 `CommissionStatementSchema`: `validated` → `paid`, once,
 * with how it was paid (ADR 0023 § Factures). `paidOn` is the day of the transfer, never after today in the agency's
 * zone (`payment_in_future_unprocessable`) nor before the first day of the statement's period
 * (`payment_before_period_unprocessable`). `reference` is refused when it holds an IBAN (400, `containsIban`).
 * `sentMinor` is what was sent, and it must be what the statement pays (`payment_amount_unprocessable`; whether another
 * amount may be recorded is a question the EQ-05 card keeps open): a statement that pays nothing, its total carried
 * over, stays validated.
 */
export const PayCommissionStatementBodySchema = z.object({
  revision: z.number().int().min(1),
  paidOn: CalendarDaySchema,
  method: PaymentMethodSchema,
  reference: PaymentReferenceSchema.optional(),
  sentMinor: SentMinorSchema,
});
export type PayCommissionStatementBody = z.infer<typeof PayCommissionStatementBodySchema>;

/** May `reader` validate this statement: a draft that is not their own, and a scope that validates. */
export function mayValidateStatement(
  statement: { readonly memberId: string; readonly status: CommissionStatementStatus },
  reader: { readonly scope: 'owner' | 'agency' | 'self'; readonly memberId: string | null },
): boolean {
  return statement.status === 'draft' && reader.scope !== 'self' && reader.memberId !== statement.memberId;
}

/**
 * The error codes of `/v1/payroll`, for the screen to say them in French (the suffix gives the status, api.md):
 * `team_member_not_found`, `commission_statement_not_found`, `bonus_not_found`, `penalty_not_found` 404 ;
 * `commission_statement_changed_conflict` 409, another revision or other inputs than the reader saw ;
 * `commission_statement_status_conflict` 409, validating what is not a draft, paying what is not validated, correcting
 * a draft ;
 * `commission_statement_open_conflict` 409, a period that has not ended ;
 * `commission_statement_order_conflict` 409, an earlier statement of the member is still a draft or not written yet ;
 * `pay_period_order_conflict` 409, an earlier period of the team must be validated first (`details.period`) ;
 * `pay_period_reports_pending_conflict` 409, reports of the period still wait for review (`details.count`) ;
 * `pay_period_reports_unread_conflict` 409, reports the validator may not read would be left out (`details.count`) ;
 * `pay_period_not_computed_conflict` 409, a period to close that pay has not written yet (`details.period`) ;
 * `pay_period_closed_conflict` 409, a bonus, a penalty, tiers or a goal for a period already validated, or for a
 * member before they joined (`details.period`) ;
 * `penalty_cancel_conflict` 409, every period of the penalty is closed ;
 * `bonus_conflict`, `penalty_conflict`, `pay_adjustment_conflict`, `bonus_tier_set_conflict`,
 * `collective_goal_conflict`, `payout_minimum_conflict` 409, the same `id` with other values ;
 * `pay_rule_started_invalid` 400, tiers or a payout minimum from a period that has begun (PAIE-22, `details.period`) ;
 * `collective_goal_late_invalid` 400, a goal for a period past its 3rd day (PAIE-22, `details.period`) ;
 * `exchange_rate_missing_conflict` 409, a currency without a rate read ;
 * `commission_rate_missing_conflict` 409, a member to pay without a commission rate in force on the period's last day ;
 * `payment_in_future_unprocessable` 422, a payment dated after today in the agency's zone ;
 * `payment_before_period_unprocessable` 422, a payment dated before the first day of the statement's period ;
 * `payment_amount_unprocessable` 422, an amount sent that is not what the statement pays ;
 * `cursor_invalid` 400, a page cursor the periods' list did not give ;
 * `payroll_entries_too_many_unprocessable` 422, more than `PAYROLL_ENTRIES_MAX` entries of a kind in one period ;
 * `payroll_own_forbidden` 403, one's own statement, bonus, penalty or adjustment ;
 * `payroll_forbidden` 403, a member who is not the owner nor an active manager writing or reading the latest rate, or
 * a manager doing what only the owner does.
 */
export const PAYROLL_ERROR_CODES = [
  'team_member_not_found',
  'commission_statement_not_found',
  'bonus_not_found',
  'penalty_not_found',
  'commission_statement_changed_conflict',
  'commission_statement_status_conflict',
  'commission_statement_open_conflict',
  'commission_statement_order_conflict',
  'pay_period_order_conflict',
  'pay_period_reports_pending_conflict',
  'pay_period_reports_unread_conflict',
  'pay_period_not_computed_conflict',
  'pay_period_closed_conflict',
  'penalty_cancel_conflict',
  'bonus_conflict',
  'penalty_conflict',
  'pay_adjustment_conflict',
  'bonus_tier_set_conflict',
  'collective_goal_conflict',
  'payout_minimum_conflict',
  'pay_rule_started_invalid',
  'collective_goal_late_invalid',
  'exchange_rate_missing_conflict',
  'commission_rate_missing_conflict',
  'payment_in_future_unprocessable',
  'payment_before_period_unprocessable',
  'payment_amount_unprocessable',
  'cursor_invalid',
  'payroll_entries_too_many_unprocessable',
  'payroll_own_forbidden',
  'payroll_forbidden',
] as const;
export type PayrollErrorCode = (typeof PAYROLL_ERROR_CODES)[number];
