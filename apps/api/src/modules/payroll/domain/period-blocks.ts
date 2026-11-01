import {
  ForeignCurrencySchema,
  TeamMemberIdSchema,
  type DomainError,
  type ForeignCurrency,
  type PayPeriodBlock,
  type TeamMemberId,
  type TeamScope,
} from '@nirvana/contracts';

import { CommissionRateMissing, MissingExchangeRate } from './errors';

/**
 * Why pay could not compute a period (EQ-04, recette du 28/10, Équipe G1), as the job records it with the period: the
 * period then reads blocked, never up to date on the figures of the last computation that passed. The job deletes it at
 * the next computation that passes.
 */
export type PeriodBlockReason =
  | { readonly code: 'commission_rate_missing_conflict'; readonly memberIds: readonly TeamMemberId[] }
  | { readonly code: 'exchange_rate_missing_conflict'; readonly currency: ForeignCurrency };

/**
 * The reason a recalculation's refusal gives the period, `null` for one the period does not record (the job still
 * logs it). Members in one order, each once, so that the same reason reads the same and a replay writes nothing.
 */
export function blockReasonOf(error: DomainError): PeriodBlockReason | null {
  if (error instanceof CommissionRateMissing) {
    return {
      code: 'commission_rate_missing_conflict',
      memberIds: [...new Set(error.memberIds)].sort().map((id) => TeamMemberIdSchema.parse(id)),
    };
  }
  if (error instanceof MissingExchangeRate) {
    // The euro is never converted: a refusal on it would be a bug, logged, never a reason shown to the team.
    const currency = ForeignCurrencySchema.safeParse(error.currency);
    return currency.success ? { code: 'exchange_rate_missing_conflict', currency: currency.data } : null;
  }
  return null;
}

/** A reason as one text: the same members in the same order, or the same currency. */
const keyOf = (reason: PeriodBlockReason): string =>
  reason.code === 'commission_rate_missing_conflict'
    ? `${reason.code}:${reason.memberIds.join(',')}`
    : `${reason.code}:${reason.currency}`;

/** Whether two reasons are the same, so that the period keeps when it was first blocked. */
export const sameReason = (a: PeriodBlockReason, b: PeriodBlockReason): boolean => keyOf(a) === keyOf(b);

/**
 * A block as its reader may see it. The owner and an active manager read every member without a rate; a member reads
 * that the period is blocked, and only themselves among those members (none when it is a colleague), as they read only
 * their own statement.
 */
export function blockFor(
  block: PayPeriodBlock | null,
  reader: { readonly scope: TeamScope; readonly memberId: TeamMemberId | null },
): PayPeriodBlock | null {
  if (block?.code !== 'commission_rate_missing_conflict') return block;
  if (reader.scope === 'owner' || reader.scope === 'agency') return block;
  return { ...block, memberIds: block.memberIds.filter((id) => id === reader.memberId) };
}
