import type { ExchangeRate, ForeignCurrency, UserId } from '@impera/contracts';
import { and, eq, schema, sql, withMember, type Database, type Transaction } from '@impera/db';

import { exchangeRateOfRow } from './snapshot';

const { exchangeRates } = schema;

/**
 * The newest rate written for a currency (ADR 0033), `null` before the first, in the caller's transaction; with
 * `onOrBefore`, the newest of that day or before it (a sale's day, as the creator's screen and the Dashboard convert).
 * Another module's job reads it this way on its own connection (Telegram's minimum price, CRM-04 lot b).
 */
export async function latestRateOf(
  tx: Transaction,
  currency: ForeignCurrency,
  onOrBefore?: string,
): Promise<ExchangeRate | null> {
  const [row] = await tx
    .select()
    .from(exchangeRates)
    .where(
      onOrBefore === undefined
        ? eq(exchangeRates.currency, currency)
        : and(eq(exchangeRates.currency, currency), sql`${exchangeRates.day} <= ${onOrBefore}::date`),
    )
    .orderBy(sql`${exchangeRates.day} desc`)
    .limit(1);
  return row === undefined ? null : exchangeRateOfRow(row);
}

/**
 * The newest rate written for a currency (ADR 0033), `null` before the first: the « dernier taux connu » that a draft
 * of pay keeps, offered to the other modules through `index.ts` (the Dashboard ranks its best fans with it). Read on
 * the application role, under the reader's own member context (`withMember`): the policy `team_read` of migration 0028
 * opens the rates to any scope set, so no policy is widened, no function runs as its owner and no admin connection
 * serves a request. What the caller shows of it is its own business: pay's `GET /v1/payroll/exchange-rates` stays
 * closed to the scope `self`.
 */
export function createLatestRateRead(
  db: Database,
): (userId: UserId, currency: ForeignCurrency) => Promise<ExchangeRate | null> {
  return (userId, currency) => withMember(db, userId, (tx) => latestRateOf(tx, currency));
}
