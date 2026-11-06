import { sql, type Database } from '@impera/db';
import { z } from 'zod';

/**
 * How long a job that spent all its attempts stays in Graphile's queue. Graphile deletes a job once it succeeds, never
 * once it is given up on: its payload would stay there forever, out of any tenant's table and of row-level security,
 * and a payload can carry what a person wrote (the note a chatter leaves on a fan, `conversation.record_facts`).
 * The Dashboard and `/ready` show a job given up on until then (`readStuckJobs`).
 */
export const DEAD_JOB_RETENTION_DAYS = 30;

const PurgedSchema = z.array(z.object({ id: z.union([z.string(), z.number()]) }));

/**
 * Deletes the jobs given up on for more than `DEAD_JOB_RETENTION_DAYS`, never one a worker holds: Graphile's own
 * `DELETE_PERMAFAILED_JOBS` cleanup, bounded by age. Run by every worker at start and each hour; two at once is
 * harmless. Says how many.
 */
export async function purgeDeadJobs(adminDb: Database): Promise<number> {
  const result = await adminDb.execute(sql`
    delete from graphile_worker._private_jobs
     where attempts >= max_attempts
       and locked_at is null
       and updated_at < now() - make_interval(days => ${DEAD_JOB_RETENTION_DAYS})
    returning id`);
  return PurgedSchema.parse(result.rows).length;
}
