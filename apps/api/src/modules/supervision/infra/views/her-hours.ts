import {
  AgentHoursSchema,
  DayRangeSchema,
  DEFAULT_AGENT_HOURS,
  type AgentHours,
  type DatedRanges,
} from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';
import { z } from 'zod';

const DatedSchema = z.array(z.object({ date: z.string(), ranges: z.array(DayRangeSchema) }));

/**
 * Her hours as the worker reads them, in her tenant transaction: none stored, or unreadable, are the defaults (always
 * open); her dated exceptions (ADR 0148 § 3) from eight days before her today on, a date that has one following its
 * ranges alone.
 */
export async function herHours(
  tx: Transaction,
  creatorId: string,
  timeZone: string,
  stored: unknown,
): Promise<{ readonly hours: AgentHours; readonly timeZone: string; readonly exceptions: DatedRanges }> {
  const hours = AgentHoursSchema.safeParse(stored);
  const dated = DatedSchema.parse(
    (
      await tx.execute(
        sql`select to_char(date, 'YYYY-MM-DD') as date, ranges from agent_hour_exceptions
            where creator_id = ${creatorId}::uuid
              and date >= (now() at time zone ${timeZone})::date - 8
            order by date`,
      )
    ).rows,
  );
  return { hours: hours.success ? hours.data : DEFAULT_AGENT_HOURS, timeZone, exceptions: dated };
}
