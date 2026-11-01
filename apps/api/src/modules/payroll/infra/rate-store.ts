import { ForeignCurrencySchema } from '@nirvana/contracts';
import { inArray, schema, sql, withAdmin, type Database } from '@nirvana/db';
import { z } from 'zod';

import type { PayrollRateStore } from '../domain/ports';

const { exchangeRates } = schema;

const keyOf = (rate: { readonly currency: string; readonly day: string }): string =>
  `${rate.currency} ${rate.day}`;

const LatestDaySchema = z.object({ currency: ForeignCurrencySchema, day: z.iso.date() });

/**
 * `exchange_rates` (ADR 0033), on the admin connection: the table is the job's alone. `ON CONFLICT DO NOTHING` on its
 * key (currency, day), so that a run is replayable and a day once written never changes (the trigger refuses it too).
 */
export function createDrizzlePayrollRateStore(adminDb: Database): PayrollRateStore {
  return {
    addUnscoped: (rates) =>
      withAdmin(adminDb, async (tx) => {
        if (rates.length === 0) return { written: 0, differing: [] };
        const inserted = await tx
          .insert(exchangeRates)
          .values(rates.map((rate) => ({ ...rate, fetchedAt: new Date(rate.fetchedAt) })))
          .onConflictDoNothing()
          .returning({ currency: exchangeRates.currency, day: exchangeRates.day });
        const written = new Set(inserted.map(keyOf));
        const known = rates.filter((rate) => !written.has(keyOf(rate)));
        if (known.length === 0) return { written: inserted.length, differing: [] };
        const stored = await tx
          .select({
            currency: exchangeRates.currency,
            day: exchangeRates.day,
            rateMicros: exchangeRates.rateMicros,
          })
          .from(exchangeRates)
          .where(
            inArray(
              exchangeRates.day,
              known.map((rate) => rate.day),
            ),
          );
        const storedMicros = new Map(stored.map((row) => [keyOf(row), row.rateMicros]));
        return {
          written: inserted.length,
          differing: known.filter((rate) => storedMicros.get(keyOf(rate)) !== rate.rateMicros),
        };
      }),
    latestDaysUnscoped: () =>
      withAdmin(adminDb, async (tx) => {
        const rows = await tx
          .select({ currency: exchangeRates.currency, day: sql<unknown>`max(${exchangeRates.day})::text` })
          .from(exchangeRates)
          .groupBy(exchangeRates.currency);
        return new Map(rows.map((row) => LatestDaySchema.parse(row)).map((row) => [row.currency, row.day]));
      }),
  };
}
