import {
  CreatorIdSchema,
  McpSalesInputSchema,
  McpSalesListSchema,
  type CreatorId,
  type McpSalesList,
  type SalesOfCreator,
} from '@impera/contracts';

import type { CreatorReader, SalesReader } from '../domain/ports';

import type { ServedTool } from './dispatch';

type SalesRow = McpSalesList['creators'][number]['rows'][number];

/**
 * A creator's rows summed over every seller and every account (Charles's decision A, 14/11): one row per day,
 * platform, currency and kind, in that order. What a seller sold never reaches the output, so no amount per member does.
 */
function summed(rows: SalesOfCreator['rows']): SalesRow[] {
  const sums = new Map<string, SalesRow>();
  for (const row of rows) {
    const key = [row.day, row.platform, row.currency, row.saleType].join('|');
    const sum = sums.get(key);
    if (sum === undefined) {
      sums.set(key, {
        day: row.day,
        platform: row.platform,
        currency: row.currency,
        saleType: row.saleType,
        sales: row.sales,
        refunds: row.refunds,
        grossInclVatMinor: row.grossInclVatMinor,
        grossExclVatMinor: row.grossExclVatMinor,
        netMinor: row.netMinor,
      });
    } else {
      sums.set(key, {
        ...sum,
        sales: sum.sales + row.sales,
        refunds: sum.refunds + row.refunds,
        grossInclVatMinor: sum.grossInclVatMinor + row.grossInclVatMinor,
        grossExclVatMinor: sum.grossExclVatMinor + row.grossExclVatMinor,
        netMinor: sum.netMinor + row.netMinor,
      });
    }
  }
  return [...sums.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, row]) => row);
}

/**
 * The sales tools (ADR 0073, ADR 0105 § 3 and § 4, `read:sales`), read through `connectors` as the access's person,
 * whose role `resolveActor` read for this call. Closed by Charles's decision A (14/11): no amount per member, no share.
 */
export function salesTools(
  sales: SalesReader,
  creators: CreatorReader,
): Readonly<Record<string, ServedTool>> {
  return {
    sales_list: {
      description:
        'Les ventes relevées sur la plateforme pour les créatrices de cet accès (la sienne pour un accès borné, sinon celles que tu lis ; un manager, seulement celles de sa liste), du jour `from` au jour `to` inclus (93 jours au plus) : par créatrice, par jour, plateforme, devise et type de vente, le nombre de ventes et de remboursements, le chiffre TTC, HT et le net, additionnés sur tous les vendeurs. Jamais un vendeur, un membre, un montant par membre, ni la part de l’agence ou de la créatrice. Un jour non relevé n’est pas un jour sans vente : regarde `readings`.',
      input: McpSalesInputSchema,
      output: McpSalesListSchema,
      run: async ({ grant, actor, creatorId }, input): Promise<McpSalesList> => {
        const { from, to } = McpSalesInputSchema.parse(input);
        // Confined to the access's creator, or the one named; else those the person reads now, without the archived.
        const ids: readonly CreatorId[] =
          creatorId !== null
            ? [CreatorIdSchema.parse(creatorId)]
            : (
                await creators.unarchived(
                  actor.readableCreatorIds === 'all'
                    ? 'all'
                    : actor.readableCreatorIds.map((id) => CreatorIdSchema.parse(id)),
                )
              ).map((creator) => CreatorIdSchema.parse(creator.id));
        const reads = ids.length === 0 ? [] : await sales.sales(grant.userId, ids, { from, to });
        return {
          from,
          to,
          creators: reads.map((read) => ({
            creatorId: CreatorIdSchema.parse(read.creatorId),
            rows: summed(read.rows),
            refundsWithoutSale: read.refundsWithoutSale,
            readings: read.readings.map((reading) => ({
              platform: reading.platform,
              readAt: reading.readAt,
              pausedUntil: reading.pausedUntil,
            })),
          })),
        };
      },
    },
  };
}
