import {
  CreatorAlertCodeSchema,
  CreatorAlertModeSchema,
  CreatorAlertRoleSchema,
  CreatorIdSchema,
} from '@impera/contracts';
import { and, eq, inArray, schema, sql, withAdmin, type Database, type Transaction } from '@impera/db';

import type { RoutedEventRow, RouterReads } from '../../application/route';
import { AGENCY_EVENT_TYPES } from '../../domain/agency/classify';
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
  const eventsOf = async (types: readonly string[], since: Date): Promise<RoutedEventRow[]> => {
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
              inArray(table.type, [...types]),
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
  };
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

    events(since) {
      return eventsOf([...ROUTED_EVENT_TYPES], since);
    },

    agencyEvents(since) {
      return eventsOf([...AGENCY_EVENT_TYPES], since);
    },

    async waitingSafety(since) {
      const rows = await admin((tx) =>
        tx.execute<{
          id: string;
          creator_id: string | null;
          conversation_id: string | null;
          created_at: string;
        }>(sql`
          select e.id, e.creator_id, e.payload ->> 'conversationId' as conversation_id, e.created_at::text as created_at
          from domain_events e
          where e.type = 'handoff_requested'
            and e.created_at > ${since.toISOString()}::timestamptz
            and e.payload ->> 'cause' in (${sql.join(
              SAFETY_HANDOFF_CAUSES.map((cause) => sql`${cause}`),
              sql`, `,
            )})
            and not exists (
              select 1 from domain_events t
              where t.type in ('takeover_started', 'takeover_ended')
                and t.payload ->> 'conversationId' = e.payload ->> 'conversationId'
                and t.created_at >= e.created_at
            )
          order by e.created_at, e.id
        `),
      );
      return rows.rows.flatMap((row) => {
        const creatorId = CreatorIdSchema.safeParse(row.creator_id);
        return creatorId.success
          ? [
              {
                id: row.id,
                creatorId: creatorId.data,
                conversationId: row.conversation_id,
                createdAt: new Date(row.created_at),
              },
            ]
          : [];
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

    async creatorAccounts(creatorId) {
      return admin(async (tx) => {
        const [creator] = await tx
          .select({ timeZone: schema.creators.timezone })
          .from(schema.creators)
          .where(eq(schema.creators.id, creatorId));
        // Strictly hers: an account given several creators, or none, is never told (relecture Sécurité).
        const accounts = await tx
          .select({ id: schema.user.id })
          .from(schema.user)
          .where(
            and(
              eq(schema.user.role, 'creator'),
              sql`${schema.user.creatorIds} = array[${creatorId}]::uuid[]`,
            ),
          )
          .orderBy(schema.user.id);
        return accounts.map((one) => ({ userId: one.id, timeZone: creator?.timeZone ?? 'Europe/Paris' }));
      });
    },
  };
}
