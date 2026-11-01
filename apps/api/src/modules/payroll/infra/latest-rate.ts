import type { ExchangeRate, ForeignCurrency, UserId } from '@nirvana/contracts';
import { eq, schema, sql, withMember, type Database } from '@nirvana/db';

import { exchangeRateOfRow } from './snapshot';

const { exchangeRates } = schema;

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
  return (userId, currency) =>
    withMember(db, userId, async (tx) => {
      const [row] = await tx
        .select()
        .from(exchangeRates)
        .where(eq(exchangeRates.currency, currency))
        .orderBy(sql`${exchangeRates.day} desc`)
        .limit(1);
      return row === undefined ? null : exchangeRateOfRow(row);
    });
}
