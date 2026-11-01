import { JOB_MAX_ATTEMPTS, type JobName } from '@nirvana/contracts';
import { sql, type Database } from '@nirvana/db';
import { parseCronItems, type CronItem, type ParsedCronItem } from 'graphile-worker';
import { z } from 'zod';

export interface CronJob extends CronItem {
  readonly task: JobName;
}

/**
 * Periodic jobs (ADR 0006). In code rather than in a Graphile `crontab` file: the text format refuses dots in
 * task names (`connector.dispatch`), and here each entry is checked against the contract's job names.
 */
const CRON_JOBS: readonly CronJob[] = [
  // Enqueues one poll per platform account on its serial queue `account:<id>` (P0-06). No backfill: minutes
  // missed during an outage are not replayed, the next run polls everything anyway.
  {
    task: 'connector.dispatch',
    match: '* * * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['connector.dispatch'] },
  },
  // Re-checks the saved AI service keys (ADR 0016): credit, revoked keys, recovery after a refusal. No backfill:
  // the next run checks everything anyway.
  {
    task: 'providers.check_credentials',
    match: '*/15 * * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['providers.check_credentials'] },
  },
  // Telegram notifications (ADR 0020). The scan is the trigger's safety net: an event whose trigger could not
  // enqueue is read within the minute. The polls read the groups the bots sit in; the digest decides each hour
  // whether it is morning somewhere; the purge drops the deliveries past their retention.
  ...(['telegram.scan', 'telegram.dispatch_polls'] as const).map((task) => ({
    task,
    match: '* * * * *',
    options: { backfillPeriod: 0, maxAttempts: 1 },
  })),
  { task: 'telegram.morning_digest', match: '0 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  { task: 'telegram.purge', match: '30 3 * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // Her facts about a fan last seen a year ago go (security.md, P3-02).
  { task: 'fans.purge_facts', match: '45 3 * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // The rate limiter's ended windows go, and the hashed IPs and accounts they counted with them (ADR 0027).
  { task: 'rate_limit.purge', match: '*/10 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // A daily export missing for 26 hours alerts the owner (ADR 0028 § 5); the next hour is the retry.
  { task: 'backups.check', match: '17 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // The running templates make their shifts four weeks ahead (EQ-02); each occurrence is made once, so the hour that
  // follows a failure, a member back from leave or a new day simply catches up.
  { task: 'scheduling.make_shifts', match: '41 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // A swap proposal lapses once one of its shifts started, was cancelled or changed hands or hours (ADR 0031). Each
  // acceptance and revert enqueues it too; the quarter hour catches a shift that started or was changed by hand.
  { task: 'scheduling.lapse_swaps', match: '*/15 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // A role dated for a 1st or a 16th becomes the member's on that day (Charles, 28/10): each record takes the role in
  // force today, before the hour's recalculation. A run missed is caught up by the next one, no backfill.
  { task: 'team.apply_roles', match: '3 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // Pay's drafts of every open period, computed again each hour (EQ-04): what a report, a rate or a change of period
  // brought, should its own job have been missed. A run that finds nothing new writes nothing.
  { task: 'payroll.recalculate_open', match: '23 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
  // The ECB's rates (ADR 0033), published around 16:00 CET each working day: read each hour, before the hour's
  // recalculation, so that a new rate reaches the drafts within the hour. The file holds 90 days: a run missed during
  // an outage is caught up by the next one, no backfill. Its retries are the contract's.
  {
    task: 'payroll.fetch_exchange_rates',
    match: '7 * * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.fetch_exchange_rates'] },
  },
];

export function parsedCronJobs(jobs: readonly CronJob[] = CRON_JOBS): ParsedCronItem[] {
  return parseCronItems([...jobs]);
}

/** The moment as JSON writes it: the driver hands timestamps over as Postgres text. */
const KnownSinceSchema = z.object({ knownSince: z.iso.datetime({ offset: true }) });

/**
 * When a worker first carried a periodic job on this database: Graphile writes it in its known crontabs as that worker
 * starts, and the first run falls due within the next period. `null` if no worker ever carried it here. Graphile keeps
 * the table private, as it does the jobs `readiness.ts` reads; owner role.
 */
export async function cronKnownSince(
  adminDb: Pick<Database, 'execute'>,
  task: JobName,
): Promise<Date | null> {
  const result = await adminDb.execute(
    sql`select to_json(known_since) #>> '{}' as "knownSince" from graphile_worker._private_known_crontabs
        where identifier = ${task}`,
  );
  const [row] = result.rows;
  return row === undefined ? null : new Date(KnownSinceSchema.parse(row).knownSince);
}
