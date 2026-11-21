import {
  AgentHoursSchema,
  AuditEntryIdSchema,
  DayRangeSchema,
  localDate,
  newId,
  type AgentHourExceptionsView,
  type CreatorId,
} from '@impera/contracts';
import { and, eq, schema, sql, withTenant, type Database } from '@impera/db';
import { z } from 'zod';

import { AgentHourExceptionPast } from '../../domain/errors';
import type { AgentHourExceptions } from '../../domain/ports';

import { moveReopen } from './creator-directory';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

const StoredRangesSchema = z.array(DayRangeSchema);

/**
 * `agent_hour_exceptions` (ADR 0148 § 3), inside `withTenant` of her creator: its RLS keeps every creator's dates
 * apart. Her clock (`creators.timezone`) decides what « today » is; a date before it no longer changes.
 */
export function createDrizzleAgentHourExceptions(
  db: Database,
  now: () => Date = () => new Date(),
): AgentHourExceptions {
  const zoneOf = async (creatorId: CreatorId): Promise<string | null> => {
    const [row] = await db
      .select({ timezone: schema.creators.timezone })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId));
    return row?.timezone ?? null;
  };

  /** The fans her hours put off wait for her opening under the dates as they are now (ADR 0148 § 3). */
  const reopenAfter = async (tx: Transaction, creatorId: CreatorId, timeZone: string, change: string) => {
    const [row] = await tx
      .select({ agentHours: schema.creators.agentHours })
      .from(schema.creators)
      .where(eq(schema.creators.id, creatorId));
    const stored = AgentHoursSchema.safeParse(row?.agentHours);
    await moveReopen(
      tx,
      { id: creatorId, hours: stored.success ? stored.data : null, timezone: timeZone },
      now(),
      change,
    );
  };

  const read = async (
    tx: Transaction,
    creatorId: CreatorId,
    timeZone: string,
    today: string,
  ): Promise<AgentHourExceptionsView> => {
    const rows = await tx
      .select({
        date: schema.agentHourExceptions.date,
        ranges: schema.agentHourExceptions.ranges,
        updatedBy: schema.agentHourExceptions.updatedBy,
        updatedAt: schema.agentHourExceptions.updatedAt,
      })
      .from(schema.agentHourExceptions)
      .where(
        and(
          eq(schema.agentHourExceptions.creatorId, creatorId),
          sql`${schema.agentHourExceptions.date} >= ${today}::date`,
        ),
      )
      .orderBy(sql`${schema.agentHourExceptions.date} asc`);
    return {
      // A row the contract no longer reads is left out rather than read as « no agent that day ».
      exceptions: rows.flatMap((row) => {
        const ranges = StoredRangesSchema.safeParse(row.ranges);
        return ranges.success
          ? [
              {
                date: row.date,
                ranges: ranges.data,
                updatedBy: row.updatedBy,
                updatedAt: row.updatedAt.toISOString(),
              },
            ]
          : [];
      }),
      timeZone,
      today,
    };
  };

  /** Her zone and today, then `fn` in her tenant; `null` when she does not exist. */
  const inHerDay = async <T>(
    creatorId: CreatorId,
    fn: (tx: Transaction, timeZone: string, today: string) => Promise<T>,
  ): Promise<T | null> => {
    const timeZone = await zoneOf(creatorId);
    if (timeZone === null) return null;
    const today = localDate(now(), timeZone);
    return withTenant(db, creatorId, (tx) => fn(tx, timeZone, today));
  };

  const audit = async (
    tx: Transaction,
    creatorId: CreatorId,
    userId: string,
    details: Record<string, unknown>,
  ): Promise<void> => {
    await tx.insert(schema.auditLog).values({
      id: newId(AuditEntryIdSchema),
      userId,
      action: 'creator.agent_hour_exception',
      entity: 'creator',
      entityId: creatorId,
      details,
    });
  };

  return {
    list: (creatorId) => inHerDay(creatorId, (tx, timeZone, today) => read(tx, creatorId, timeZone, today)),

    set: (creatorId, date, ranges, userId) =>
      inHerDay(creatorId, async (tx, timeZone, today) => {
        if (date < today) throw new AgentHourExceptionPast();
        const stored = StoredRangesSchema.parse(ranges);
        const at = now();
        await tx
          .insert(schema.agentHourExceptions)
          .values({
            id: newId(z.uuid()),
            creatorId,
            date,
            ranges: stored,
            updatedBy: userId,
            createdAt: at,
            updatedAt: at,
          })
          .onConflictDoUpdate({
            target: [schema.agentHourExceptions.creatorId, schema.agentHourExceptions.date],
            set: { ranges: stored, updatedBy: userId, updatedAt: at },
          });
        await audit(tx, creatorId, userId, { date, ranges: stored });
        await reopenAfter(tx, creatorId, timeZone, `agent_hour_exception:${creatorId}:${date}`);
        return read(tx, creatorId, timeZone, today);
      }),

    remove: (creatorId, date, userId) =>
      inHerDay(creatorId, async (tx, timeZone, today) => {
        if (date < today) throw new AgentHourExceptionPast();
        const removed = await tx
          .delete(schema.agentHourExceptions)
          .where(
            and(
              eq(schema.agentHourExceptions.creatorId, creatorId),
              eq(schema.agentHourExceptions.date, date),
            ),
          )
          .returning({ id: schema.agentHourExceptions.id });
        if (removed.length > 0) {
          await audit(tx, creatorId, userId, { date, ranges: null });
          await reopenAfter(tx, creatorId, timeZone, `agent_hour_exception:${creatorId}:${date}`);
        }
        return read(tx, creatorId, timeZone, today);
      }),
  };
}
