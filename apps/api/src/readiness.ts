import { migrationStatus, sql, type Database } from '@impera/db';

import { countOrphanedJobs } from './orphaned-locks';

/** A worker that has not written its heartbeat for this long is considered gone (P0-04). */
const HEARTBEAT_MAX_AGE_SECONDS = 90;
const CHECK_TIMEOUT_MS = 2_000;

export interface Readiness {
  readonly isReady: boolean;
  readonly checks: {
    readonly database: boolean;
    readonly migrations: boolean;
    readonly worker: boolean;
  };
  /**
   * Jobs Graphile gave up on (attempts spent): they stay in its table with their last error, for an operator to
   * read (operations.md). They do not make the API unready; `null` when the count could not be read. Optional
   * so that a test stub may leave it out.
   */
  readonly deadJobs?: number | null;
  /**
   * Jobs still held by the lock of a worker that is gone (recette MOT-02): a running worker frees them within a
   * minute, so a number that stays says no worker frees them. `null` when the count could not be read.
   */
  readonly orphanedJobs?: number | null;
}

async function within<T>(promise: Promise<T>, fallback: T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      resolve(fallback);
    }, CHECK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([promise.catch(() => fallback), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A given-up job of no creator (cron tick, scan) counts this long, then no more: the next tick has redone its work, and
 * nothing ever deletes the row (recette 28/10). A creator's own given-up job counts until it is dealt with.
 */
const SYSTEM_DEAD_JOB_HOURS = 24;

/** A job no worker task takes is stuck once it has waited this long: it never spends an attempt. */
const ORPHAN_AFTER_MINUTES = 15;

/** A stuck job's task, how many, and whether they are hers (payload `creatorId`) or of no creator. */
export interface StuckJobs {
  readonly task: string;
  readonly hers: boolean;
  readonly count: number;
}

/**
 * Stuck jobs that may concern one creator, by task: hers (payload `creatorId`) and the ones of no creator (cron,
 * dispatch, pay). Stuck is given up on (attempts spent), or due for `ORPHAN_AFTER_MINUTES` under a name the worker
 * has no task for (`handledTasks`): Graphile leaves those in the queue forever. Which of them stop her agent is the
 * Dashboard's call (`AGENT_SYSTEM_JOBS`). `null` when they could not be read in time.
 */
export function readStuckJobs(
  adminDb: Database,
  creatorId: string,
  handledTasks: readonly string[],
): Promise<readonly StuckJobs[] | null> {
  // `not in (null)` is never true: without a task list, no job counts as orphaned.
  const handled =
    handledTasks.length === 0
      ? sql`null`
      : sql.join(
          handledTasks.map((task) => sql`${task}`),
          sql`, `,
        );
  return within(
    adminDb
      .execute<{ task: string; hers: boolean; count: number }>(
        // The public `jobs` view has no payload: the tables behind it do.
        sql`select task.identifier as task, (job.payload->>'creatorId' is not null) as hers, count(*)::int as count
            from graphile_worker._private_jobs job
            join graphile_worker._private_tasks task on task.id = job.task_id
            where ((job.attempts >= job.max_attempts
                    and (job.payload->>'creatorId' is not null
                         or job.updated_at > now() - make_interval(hours => ${SYSTEM_DEAD_JOB_HOURS})))
                or (task.identifier not in (${handled}) and job.locked_at is null
                    and job.run_at < now() - make_interval(mins => ${ORPHAN_AFTER_MINUTES})))
              and (job.payload->>'creatorId' is null or job.payload->>'creatorId' = ${creatorId})
            group by 1, 2
            order by 1, 2`,
      )
      .then((result) => result.rows.map((row) => ({ task: row.task, hers: row.hers, count: row.count }))),
    null,
  );
}

/**
 * `/ready` (operations.md § Santé): the database answers, the shipped migrations are applied, and some worker
 * wrote its heartbeat recently. The age is computed by Postgres so that the API's clock does not matter.
 */
export async function checkReadiness(db: Database, adminDb: Database): Promise<Readiness> {
  const [database, migrations, worker, deadJobs, orphanedJobs] = await Promise.all([
    within(
      db.execute(sql`select 1`).then(() => true),
      false,
    ),
    within(
      migrationStatus(adminDb).then((status) => status.isUpToDate),
      false,
    ),
    within(
      db
        .execute<{ fresh: boolean }>(
          sql`select coalesce(max(last_seen_at) > now() - make_interval(secs => ${HEARTBEAT_MAX_AGE_SECONDS}), false) as fresh
              from worker_heartbeats`,
        )
        .then((result) => result.rows[0]?.fresh === true),
      false,
    ),
    within(
      adminDb
        .execute<{ dead: number }>(
          sql`select count(*)::int as dead from graphile_worker._private_jobs
              where attempts >= max_attempts
                and (payload->>'creatorId' is not null
                     or updated_at > now() - make_interval(hours => ${SYSTEM_DEAD_JOB_HOURS}))`,
        )
        .then((result) => result.rows[0]?.dead ?? null),
      null,
    ),
    within(countOrphanedJobs(adminDb), null),
  ]);
  return {
    isReady: database && migrations && worker,
    checks: { database, migrations, worker },
    deadJobs,
    orphanedJobs,
  };
}
