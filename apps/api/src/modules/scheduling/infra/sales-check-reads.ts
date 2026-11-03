import {
  CurrencySchema,
  EarningsSourceSchema,
  PayPeriodSchema,
  PlatformAccountIdSchema,
  PlatformSchema,
  type PayPeriod,
} from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

import { detectedForCheck, type DetectedAccountForCheck } from '../domain/sales-checks';

import { agencyTimeZone } from './rows';

const RuleRowSchema = z.object({
  platform_account_id: PlatformAccountIdSchema,
  platform: PlatformSchema,
  currency: CurrencySchema,
  from_period: PayPeriodSchema,
  earnings_source: EarningsSourceSchema,
  created_at: z.union([z.date(), z.string()]).transform((value) => new Date(value)),
});

/**
 * @public
 * What the automatic sales check reads of the pay rules (CRM-04 b3), in the caller's transaction, the job's admin
 * connection: the accounts paid on the platform's net over the whole of `period` (`detectedForCheck`). Read only: it
 * changes no rule and pay never reads what the check publishes.
 */
export const salesCheckReads = {
  detectedAccounts: async (tx: Transaction, period: PayPeriod): Promise<DetectedAccountForCheck[]> => {
    const result = await tx.execute(sql`
      select a.platform_account_id, p.platform, a.currency, a.from_period::text as from_period, a.earnings_source,
             a.created_at
        from account_pay_rules a
        join platform_accounts p on p.id = a.platform_account_id`);
    const rules = result.rows.map((raw) => {
      const row = RuleRowSchema.parse(raw);
      return {
        platformAccountId: row.platform_account_id,
        platform: row.platform,
        currency: row.currency,
        fromPeriod: row.from_period,
        earningsSource: row.earnings_source,
        createdAt: row.created_at,
      };
    });
    return detectedForCheck(rules, period, await agencyTimeZone(tx));
  },
};
