import { sql, type Database } from '@impera/db';
import { z } from 'zod';

/**
 * A worker killed mid-job (`kill -9`, out of memory, a crash) leaves its jobs and its queues (`conv:<id>`,
 * `account:<id>`) locked: Graphile frees them only when the lock is 4 hours old, and until then nothing else of that
 * conversation or account runs (recette MOT-02). Every worker beats its pool id into `worker_heartbeats` every 30 s;
 * a lock older than `ORPHAN_LOCK_MINUTES` held by a pool that has not beaten for as long is a dead worker's.
 *
 * Both ages are far above the heartbeat's 30 s, so a live worker whose database stalls a moment is never taken for a
 * dead one: freeing a live worker's lock would run its job twice.
 */
const ORPHAN_LOCK_MINUTES = 5;

const LockersSchema = z.array(z.object({ locked_by: z.string().min(1) }));

/** The pools whose locks are a dead worker's, in jobs or in queues. */
const orphanedLockers = sql`
  select locked_by from graphile_worker._private_jobs
   where locked_by is not null and locked_at < now() - make_interval(mins => ${ORPHAN_LOCK_MINUTES})
  union
  select locked_by from graphile_worker._private_job_queues
   where locked_by is not null and locked_at < now() - make_interval(mins => ${ORPHAN_LOCK_MINUTES})`;

const alive = sql`
  select worker_id from worker_heartbeats
   where last_seen_at > now() - make_interval(mins => ${ORPHAN_LOCK_MINUTES})`;

/**
 * Frees the locks of dead workers through Graphile's own `force_unlock_workers` (the job is retried, its attempt
 * spent), and says whose. Run by every worker at start and each minute; two workers doing it at once is harmless.
 */
export async function releaseOrphanedLocks(adminDb: Database): Promise<string[]> {
  const result = await adminDb.execute(
    sql`select distinct locked_by from (${orphanedLockers}) lockers where locked_by not in (${alive})`,
  );
  const lockers = LockersSchema.parse(result.rows).map((row) => row.locked_by);
  if (lockers.length === 0) return [];
  const ids = sql.join(
    lockers.map((id) => sql`${id}`),
    sql`, `,
  );
  await adminDb.execute(sql`select graphile_worker.force_unlock_workers(array[${ids}]::text[])`);
  return lockers;
}

/** Jobs held by a dead worker's lock, for `/ready`: freed within a minute while a worker runs, so mostly zero. */
export async function countOrphanedJobs(adminDb: Database): Promise<number> {
  const result = await adminDb.execute<{ orphaned: number }>(
    sql`select count(*)::int as orphaned from graphile_worker._private_jobs
         where locked_by is not null and locked_at < now() - make_interval(mins => ${ORPHAN_LOCK_MINUTES})
           and locked_by not in (${alive})`,
  );
  return result.rows[0]?.orphaned ?? 0;
}
