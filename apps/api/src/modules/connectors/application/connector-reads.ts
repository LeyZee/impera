import {
  DailyStatsOfCreatorSchema,
  SalesByChatterOfCreatorSchema,
  SalesOfCreatorSchema,
  TeamImportLinkedSchema,
  type DailyStatsOfCreator,
  type CreatorId,
  type SalesOfCreator,
  type SalesByChatterOfCreator,
  type Platform,
  type TeamImportLinked,
} from '@impera/contracts';

import {
  distinctCreators,
  readableRange,
  salesByChatterOf,
  salesLinesOf,
  teamImportLinkedOf,
  type ConnectorReadsStore,
  type CreatorSalesRead,
  type DayRange,
} from '../domain/connector-reads';
import {
  ConnectorReadsForbidden,
  ConnectorReadsRangeUnprocessable,
  SalesFeedTeamForbidden,
} from '../domain/errors';
import type { TeamImportStore } from '../domain/team-import';

export interface ConnectorReadsDeps {
  readonly store: ConnectorReadsStore;
  readonly team: Pick<TeamImportStore, 'context' | 'counts'>;
}

/**
 * The connectors' reads for another module's adapter (ADR 0026 § 1, ADR 0105 § 4): the MCP's `sales_list`,
 * `sales_by_chatter`, `platform_daily_stats_list` and `team_import_list`. Each read is the person's: the owner, or an
 * active manager for the creators of his list; one creator refused refuses the whole call, nothing of it is given.
 * Read only: no platform is asked, nothing is written, and no amount carries the agency's nor the creator's share.
 */
export interface ConnectorReads {
  sales(userId: string, creatorIds: readonly CreatorId[], range: DayRange): Promise<SalesOfCreator[]>;
  salesByChatter(
    userId: string,
    creatorIds: readonly CreatorId[],
    range: DayRange,
  ): Promise<SalesByChatterOfCreator[]>;
  dailyStats(
    userId: string,
    creatorIds: readonly CreatorId[],
    range: DayRange,
  ): Promise<DailyStatsOfCreator[]>;
  /** The team imported from the platform as the base keeps it: the owner's and an active manager's (ADR 0076 § 8). */
  teamImport(userId: string, platform: Platform): Promise<TeamImportLinked>;
}

export function createConnectorReads(deps: ConnectorReadsDeps): ConnectorReads {
  const { store, team } = deps;

  function checked(range: DayRange): DayRange {
    if (!readableRange(range)) throw new ConnectorReadsRangeUnprocessable();
    return { from: range.from, to: range.to };
  }

  /** One read per creator, one after the other, each in its own transaction; a refused one stops the call. */
  async function each<T>(
    creatorIds: readonly CreatorId[],
    read: (creatorId: CreatorId) => Promise<T | null>,
  ): Promise<{ readonly creatorId: CreatorId; readonly value: T }[]> {
    const out: { readonly creatorId: CreatorId; readonly value: T }[] = [];
    for (const creatorId of distinctCreators(creatorIds)) {
      const value = await read(creatorId);
      if (value === null) throw new ConnectorReadsForbidden();
      out.push({ creatorId, value });
    }
    return out;
  }

  const salesOf = (userId: string, creatorIds: readonly CreatorId[], range: DayRange) => {
    const days = checked(range);
    return each<CreatorSalesRead>(creatorIds, (creatorId) => store.sales(userId, creatorId, days));
  };

  return {
    async sales(userId, creatorIds, range) {
      const reads = await salesOf(userId, creatorIds, range);
      return reads.map(({ creatorId, value }) =>
        SalesOfCreatorSchema.parse({
          creatorId,
          from: value.totals.from,
          to: value.totals.to,
          rows: salesLinesOf(value.totals),
          refundsWithoutSale: value.totals.refundsWithoutSale,
          readings: value.readings,
        }),
      );
    },

    async salesByChatter(userId, creatorIds, range) {
      const reads = await salesOf(userId, creatorIds, range);
      return reads.map(({ creatorId, value }) =>
        SalesByChatterOfCreatorSchema.parse({
          creatorId,
          from: value.totals.from,
          to: value.totals.to,
          rows: salesByChatterOf(value.totals, value.names),
          refundsWithoutSale: value.totals.refundsWithoutSale,
          readings: value.readings,
        }),
      );
    },

    async dailyStats(userId, creatorIds, range) {
      const days = checked(range);
      const reads = await each(creatorIds, (creatorId) => store.dailyStats(userId, creatorId, days));
      return reads.map(({ creatorId, value }) =>
        DailyStatsOfCreatorSchema.parse({ creatorId, from: days.from, to: days.to, days: value }),
      );
    },

    async teamImport(userId, platform) {
      const context = await team.context(userId, platform);
      if (context === null) throw new SalesFeedTeamForbidden();
      const counts = await team.counts(userId, platform);
      if (counts === null) throw new SalesFeedTeamForbidden();
      return TeamImportLinkedSchema.parse(teamImportLinkedOf(context, counts, platform));
    },
  };
}
