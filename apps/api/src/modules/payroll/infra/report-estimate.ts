import {
  payPeriodLastDay,
  type Currency,
  type EarningsSource,
  type PayPeriod,
  type ShiftId,
  type ShiftReportEstimate,
  type UserId,
} from '@impera/contracts';
import { withMember, type Database } from '@impera/db';

import { commissionOfGross } from '../domain/commission-statements';
import { RATE_SCALE } from '../domain/rounding';

import { latestRateOf } from './latest-rate';
import type { PayInputReads } from './snapshot';

/**
 * What the estimate of a report reads of the planning (reco 19): the `scheduling` module's `pay.shiftFacts`, plugged
 * by the composition root. It answers in a transaction of its own, as the reader, and refuses the shift to anyone but
 * its member, the owner and an active manager.
 */
export type ShiftFactsRead = (
  actor: UserId,
  shiftId: ShiftId,
) => Promise<{
  readonly memberId: string;
  readonly period: PayPeriod;
  readonly rules: {
    readonly currency: Currency;
    readonly earningsSource: EarningsSource;
    readonly vatBps: number;
    readonly platformFeeBps: number;
  } | null;
}>;

export type ReportEstimate = (
  actor: UserId,
  shiftId: ShiftId,
  amountMinor: number,
) => Promise<ShiftReportEstimate>;

const UNKNOWN: ShiftReportEstimate = { commissionMinor: null };

/**
 * `GET /v1/payroll/shifts/:shiftId/estimate` (reco 19): what an amount typed in the report brings the shift's member,
 * by pay's chain on that amount alone (`commissionOfGross`). The member's rate and the currency's rate are those a
 * draft of the period counts: in force on the period's last day, the newest exchange rate on or before it. Read as the
 * reader (`withMember`): the member reads only his own rate, the owner and an active manager every member's. Nothing
 * is said, never guessed, without rules, on sales the connector reads, without a rate for the member, or without an
 * exchange rate yet.
 */
export function createReportEstimate(
  db: Database,
  members: PayInputReads['members'],
  shiftFacts: ShiftFactsRead,
): ReportEstimate {
  return async (actor, shiftId, amountMinor) => {
    const { memberId, period, rules } = await shiftFacts(actor, shiftId);
    if (rules?.earningsSource !== 'declared') return UNKNOWN;
    const day = payPeriodLastDay(period);
    return withMember(db, actor, async (tx) => {
      const rate = (await members(tx, day)).find((one) => one.id === memberId)?.rate ?? null;
      if (rate === null) return UNKNOWN;
      let rateMicros = RATE_SCALE;
      if (rules.currency !== 'EUR') {
        const exchange = await latestRateOf(tx, rules.currency, day);
        if (exchange === null) return UNKNOWN;
        rateMicros = exchange.rateMicros;
      }
      return {
        commissionMinor: commissionOfGross({
          grossMinor: amountMinor,
          rateMicros,
          vatBps: rules.vatBps,
          platformFeeBps: rules.platformFeeBps,
          commissionRateBps: rate.rateBps,
        }),
      };
    });
  };
}
