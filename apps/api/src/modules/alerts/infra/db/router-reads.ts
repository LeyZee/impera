import {
  CreatorAlertCodeSchema,
  CreatorAlertModeSchema,
  CreatorAlertRoleSchema,
  CreatorIdSchema,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { RoutedEventRow, RouterReads } from '../../application/route';
import { ROUTED_EVENT_TYPES } from '../../domain/classify';
import { creatorAlertLines } from '../../domain/creator-alerts';

/** Read once per run in the worst case: a burst of events past it waits for the next minute. */
const EVENTS_LIMIT = 500;

/**
 * The router's reads (ADR 0150 § 18), as the service role, across creators: the outbox, her choices (read through
 * `creatorAlertLines`, so that a locked alert is « reçoit » whatever a row says), and who the accounts are. Read only:
 * the service role has SELECT on `creator_alert_routes` and nothing more.
 */
export function createRouterReads(adminDb: Database, agencyTimeZone: () => Promise<string>): RouterReads {
  const admin = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withAdmin(adminDb, fn);
  return {
    async events(since) {
      const table = schema.domainEvents;
      const rows = await admin((tx) =>
        tx
          .select({ id: table.id, creatorId: table.creatorId, type: table.type, payload: table.payload })
          .from(table)
          .where(
            and(
              sql`${table.createdAt} > ${since.toISOString()}::timestamptz`,
              inArray(table.type, [...ROUTED_EVENT_TYPES]),
            ),
          )
          .orderBy(table.createdAt, table.id)
          .limit(EVENTS_LIMIT),
      );
      return rows.flatMap((row): RoutedEventRow[] => {
        if (row.creatorId === null) return [{ ...row, creatorId: null }];
        const creatorId = CreatorIdSchema.safeParse(row.creatorId);
        return creatorId.success ? [{ ...row, creatorId: creatorId.data }] : [];
      });
    },

    async lines(creatorId) {
      const table = schema.creatorAlertRoutes;
      const rows = await admin((tx) =>
        tx
          .select({ alertCode: table.alertCode, role: table.role, mode: table.mode })
          .from(table)
          .where(eq(table.creatorId, creatorId)),
      );
      return creatorAlertLines(
        rows.map((row) => ({
          alertCode: CreatorAlertCodeSchema.parse(row.alertCode),
          role: CreatorAlertRoleSchema.parse(row.role),
          mode: CreatorAlertModeSchema.parse(row.mode),
        })),
      );
    },

    async creators() {
      const table = schema.creators;
      const rows = await admin((tx) =>
        tx
          .select({ id: table.id, name: table.displayName })
          .from(table)
          .where(sql`${table.archivedAt} is null`),
      );
      return rows.map((row) => ({ id: CreatorIdSchema.parse(row.id), name: row.name }));
    },

    async owners() {
      const [rows, timeZone] = await Promise.all([
        admin((tx) =>
          tx.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, 'owner')),
        ),
        agencyTimeZone(),
      ]);
      return rows.map((row) => ({ userId: row.id, timeZone }));
    },

    async managers() {
      const table = schema.teamMembers;
      const rows = await admin((tx) =>
        tx
          .select({ userId: table.userId, timeZone: table.timeZone })
          .from(table)
          .where(and(eq(table.teamRole, 'manager'), eq(table.status, 'active'))),
      );
      return rows.map((row) => ({ userId: row.userId, timeZone: row.timeZone }));
    },

    async members(memberIds) {
      if (memberIds.length === 0) return [];
      const table = schema.teamMembers;
      const rows = await admin((tx) =>
        tx
          .select({ userId: table.userId, timeZone: table.timeZone })
          .from(table)
          .where(and(inArray(table.id, [...memberIds]), eq(table.status, 'active'))),
      );
      return rows.map((row) => ({ userId: row.userId, timeZone: row.timeZone }));
    },
  };
}
