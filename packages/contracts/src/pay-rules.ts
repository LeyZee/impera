import { z } from 'zod';

import { AccountPayRulesIdSchema, CreatorIdSchema, PlatformAccountIdSchema } from './ids';
import { CurrencySchema } from './money';
import { PayPeriodSchema, type PayPeriod } from './pay-periods';
import { PlanningAccountSchema } from './scheduling';
import { BasisPointsSchema } from './team';

/**
 * The pay rules of a platform account (EQ-03; the platform settings of EQ-01 and ADR 0023), under `/v1/team/pay-rules`.
 * Set per account rather than per platform, so that an account with a negotiated fee keeps its own.
 */

/**
 * Where pay reads an account's amounts for a period (ADR 0023 § Une seule source de revenus par compte): `declared`,
 * the validated end-of-shift reports; `detected`, the sales the connector records. Never both, so that a sale never
 * counts twice.
 */
export const EARNINGS_SOURCES = ['declared', 'detected'] as const;
export const EarningsSourceSchema = z.enum(EARNINGS_SOURCES);
export type EarningsSource = z.infer<typeof EarningsSourceSchema>;

/**
 * An account's pay rules from `fromPeriod` on, until its next rules. Added only: never changed nor deleted, and one per
 * account and period at most (a unique constraint). `currency` is the account's: its reports declare in it, and pay
 * converts it to euros (EQ-04). `vatBps` is the VAT pay takes off the gross, then `platformFeeBps` the platform's
 * commission it takes off what is left, both in whole basis points (2000 = 20 %): no float in pay (ADR 0011).
 */
export const AccountPayRulesSchema = z.object({
  id: AccountPayRulesIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  creatorId: CreatorIdSchema,
  fromPeriod: PayPeriodSchema,
  currency: CurrencySchema,
  vatBps: BasisPointsSchema,
  platformFeeBps: BasisPointsSchema,
  earningsSource: EarningsSourceSchema,
  createdAt: z.iso.datetime(),
});
export type AccountPayRules = z.infer<typeof AccountPayRulesSchema>;

/** The rules in force for `period`: those with the latest `fromPeriod` at or before it, or `null` before the first. */
export function payRulesFor<R extends { readonly fromPeriod: PayPeriod }>(
  rules: readonly R[],
  period: PayPeriod,
): R | null {
  let found: R | null = null;
  for (const one of rules) {
    if (one.fromPeriod <= period && (found === null || one.fromPeriod > found.fromPeriod)) found = one;
  }
  return found;
}

/**
 * `GET /v1/team/pay-rules` (owner, active manager): every platform account, with its rules newest first (none while
 * they are not set), and the period running now in the agency's zone.
 */
export const AccountPayRulesListSchema = z.object({
  currentPeriod: PayPeriodSchema,
  accounts: z.array(z.object({ account: PlanningAccountSchema, rules: z.array(AccountPayRulesSchema) })),
});
export type AccountPayRulesList = z.infer<typeof AccountPayRulesListSchema>;

/**
 * `POST /v1/team/pay-rules` (owner only, the database refuses anyone else) → 201 `AccountPayRulesSchema`, or 200 when
 * the same `id` was already recorded with the same values (`pay_rules_conflict` otherwise). `id` is made by the client
 * when the panel opens, so a retry records one rule. Rules start with a period that has not begun, the next one at the
 * earliest, so that a period never changes rules under way; the account's first rules alone may start with the
 * current period, since nothing of that account could be declared before them (`pay_rules_period_invalid`
 * otherwise). A second rule for the same account and period answers `pay_rules_period_conflict` with
 * `details.accountPayRulesId`: the screen has the owner confirm the rules before sending them, and a mistake is put
 * right by the next rules, and in the periods it touched by an adjustment (EQ-04). `detected` answers
 * `pay_rules_source_conflict` until the connector records the sales (P6-01): an account in it would be paid nothing.
 */
export const CreateAccountPayRulesBodySchema = z.object({
  id: AccountPayRulesIdSchema,
  platformAccountId: PlatformAccountIdSchema,
  fromPeriod: PayPeriodSchema,
  currency: CurrencySchema,
  vatBps: BasisPointsSchema,
  platformFeeBps: BasisPointsSchema,
  earningsSource: EarningsSourceSchema,
});
export type CreateAccountPayRulesBody = z.input<typeof CreateAccountPayRulesBodySchema>;

/**
 * The error codes of `/v1/team/pay-rules`, for the screen to say them in French (the suffix gives the status, api.md):
 * `platform_account_not_found` 404 ; `pay_rules_conflict` 409, the same `id` with other values ;
 * `pay_rules_period_conflict` 409, this account already has rules from that period (`details.accountPayRulesId`) ;
 * `pay_rules_period_invalid` 400, a period that has begun, other than the current one for the account's first rules ;
 * `pay_rules_source_conflict` 409, `detected` before the connector records the sales.
 */
export const PAY_RULES_ERROR_CODES = [
  'platform_account_not_found',
  'pay_rules_conflict',
  'pay_rules_period_conflict',
  'pay_rules_period_invalid',
  'pay_rules_source_conflict',
] as const;
export type PayRulesErrorCode = (typeof PAY_RULES_ERROR_CODES)[number];
