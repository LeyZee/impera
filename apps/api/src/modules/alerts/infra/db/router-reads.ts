import {
  CreatorAlertCodeSchema,
  CreatorAlertModeSchema,
  CreatorAlertRoleSchema,
  CreatorIdSchema,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { RoutedEventRow, RouterReads } from '../../application/route';
import { ROUTED_EVENT_TYPES, SAFETY_HANDOFF_CAUSES } from '../../domain/classify';
import { creatorAlertLines } from '../../domain/creator-alerts';

/** One page of the window. */
const EVENTS_PAGE = 500;
/** Pages read per run at most: past it, a burst waits for the next minute (the safety relays are read apart). */
const EVENTS_PAGES = 20;

/**
 * The router's reads (ADR 0150 § 18), as the service role, across creators: the outbox, her choices (read through
 * `creatorAlertLines`, so that a locked alert is « reçoit » whatever a row says), and who the accounts are. Read only:
 * the service role has SELECT on `creator_alert_routes` and nothing more.
 */
interface RoutedRow {
  readonly id: string;
  readonly creatorId: string | null;
  readonly type: string;
  readonly payload: unknown;
}

/**
 * A row of a page, and where the next page starts. The instant is kept as Postgres writes it: a `Date` would cut its
 * microseconds, and a page cut at a millisecond would read itself again and again.
 */
interface Row extends RoutedRow {
  readonly createdAt: string;
}
type Cursor = Pick<Row, 'createdAt' | 'id'>;

function toRouted(row: RoutedRow): RoutedEventRow[] {
  const { id, type, payload } = row;
  if (row.creatorId === null) return [{ id, type, payload, creatorId: null }];
  const creatorId = CreatorIdSchema.safeParse(row.creatorId);
  return creatorId.success ? [{ id, type, payload, creatorId: creatorId.data }] : [];
}

export function createRouterReads(adminDb: Database, agencyTimeZone: () => Promise<string>): RouterReads {
  const admin = <T>(fn: (tx: Transaction) => Promise<T>): Promise<T> => withAdmin(adminDb, fn);
  return {
    async safetyEvents(since) {
      const table = schema.domainEvents;
      const rows = await admin((tx) =>
        tx
          .select({ id: table.id, creatorId: table.creatorId, type: table.type, payload: table.payload })
          .from(table)
          .where(
            and(
              sql`${table.createdAt} > ${since.toISOString()}::timestamptz`,
              eq(table.type, 'handoff_requested'),
              inArray(sql<string>`${table.payload} ->> 'cause'`, [...SAFETY_HANDOFF_CAUSES]),
            ),
          )
          .orderBy(table.createdAt, table.id),
      );
      return rows.flatMap(toRouted);
    },

    async events(since) {
      const table = schema.domainEvents;
      const page = (cursor: Cursor | null): Promise<Row[]> =>
        admin((tx) =>
          tx
            .select({
              id: table.id,
              creatorId: table.creatorId,
              type: table.type,
              payload: table.payload,
              createdAt: sql<string>`${table.createdAt}::text`,
            })
            .from(table)
            .where(
              and(
                sql`${table.createdAt} > ${since.toISOString()}::timestamptz`,
                inArray(table.type, [...ROUTED_EVENT_TYPES]),
                cursor === null
                  ? undefined
                  : sql`(${table.createdAt}, ${table.id}) > (${cursor.createdAt}::timestamptz, ${cursor.id})`,
              ),
            )
            .orderBy(table.createdAt, table.id)
            .limit(EVENTS_PAGE),
        );
      const read: RoutedEventRow[] = [];
      let cursor: Cursor | null = null;
      // Page by page to the window's newest: a burst never keeps the newest events out of the run.
      for (let count = 0; count < EVENTS_PAGES; count += 1) {
        const rows: Row[] = await page(cursor);
        for (const row of rows) read.push(...toRouted(row));
        const last = rows.at(-1);
        if (last === undefined || rows.length < EVENTS_PAGE) break;
        cursor = { createdAt: last.createdAt, id: last.id };
      }
      return read;
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
          .select({ userId: table.userId, timeZone: table.timeZone, creatorIds: schema.user.creatorIds })
          .from(table)
          .innerJoin(schema.user, eq(schema.user.id, table.userId))
          .where(and(eq(table.teamRole, 'manager'), eq(table.status, 'active'))),
      );
      return rows.map((row) => ({
        userId: row.userId,
        timeZone: row.timeZone,
        creatorIds: row.creatorIds,
      }));
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

    async memberName(memberId) {
      const table = schema.teamMembers;
      const rows = await admin((tx) =>
        tx.select({ name: table.displayName }).from(table).where(eq(table.id, memberId)).limit(1),
      );
      return rows[0]?.name ?? null;
    },
  };
}
