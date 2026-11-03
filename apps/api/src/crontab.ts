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
  // Reveal's register of sales and refunds, read from its stored cursor (ADR 0050 § 3): Reveal's own advice is one
  // call a minute. No backfill: the cursor keeps the place, the next run reads what was missed.
  {
    task: 'connector.read_sales',
    match: '* * * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['connector.read_sales'] },
  },
  // What a member no longer `active` still held (a takeover, a routed conversation) is handed back within the minute
  // (EQ-13): he already reads none of it. No backfill: the next run finds them all anyway.
  {
    task: 'conversation.release_unavailable',
    match: '* * * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['conversation.release_unavailable'] },
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
  // Each hour, acting only in a creator's 23 o'clock hour (CRM-04 lot b); the key of her day makes it once.
  { task: 'telegram.evening_digest', match: '0 * * * *', options: { backfillPeriod: 0, maxAttempts: 1 } },
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
  // The invoices' acceptance (EQ-06 lot 6, ADR 0039): a document unanswered after its deadline is accepted tacitly, an
  // open contest without its alert is said, should their own job have failed or been lost. No backfill: the next hour
  // finds them all anyway.
  {
    task: 'payroll.sweep_invoice_acceptance',
    match: '29 * * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.sweep_invoice_acceptance'] },
  },
  // The documents a contractor's regime asks for that come to their end (EQ-06 lot 5c-2): each said once to the owner, a
  // tax residence certificate from 1 December of its year. The next hour is the retry, no backfill.
  {
    task: 'payroll.remind_documents',
    match: '37 * * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.remind_documents'] },
  },
  // The invoices not settled yet that come to their due date (EQ-06 lot 8): each said once to the owner seven days
  // before it, then the day after it, in the morning in Paris (06:21 UTC). A day missed is caught up by the next run,
  // which reads the due states again, no backfill; its retries are the contract's.
  {
    task: 'payroll.remind_due_invoices',
    match: '21 6 * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.remind_due_invoices'] },
  },
  // The files of refused documents erased once their upload lock has ended (EQ-06 lot 5c-2, « ok purge a » de
  // Charles): their rows stay. The next night is the retry, no backfill.
  {
    task: 'payroll.purge_refused_documents',
    match: '51 3 * * *',
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.purge_refused_documents'] },
  },
  // The reconciliation of transfers with documents (EQ-06 lot 7a), for every contractor once a night: its own job runs
  // when a statement is validated or paid or a document issued; this catches one that failed or was lost. Writes only what is
  // missing, no backfill.
  {
    task: 'payroll.settle_documents',
    match: '33 4 * * *',
    payload: { memberId: null },
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.settle_documents'] },
  },
  // The lock of the certificates transfers relied on (ADR 0041 § 6), once a night: its own job runs with the record of
  // each transfer; this catches one a bucket failed or that was lost. Records only what is missing, no backfill.
  {
    task: 'payroll.lock_payout_certificate',
    match: '43 4 * * *',
    payload: { statementId: null },
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.lock_payout_certificate'] },
  },
  // The waiting invoices tried again once a day, whatever their trigger (EQ-06 « ok pays »): a member whose country goes
  // back to that of his regime, or any change no trigger of this module sees (the team module never calls payroll),
  // lets his invoices go out within the day. Each statement that waited is enqueued under its own key (a run that waits
  // is replaced, never doubled) and a run issues only what is missing.
  {
    task: 'payroll.requeue_invoice_issues',
    match: '13 4 * * *',
    payload: { memberId: null },
    options: { backfillPeriod: 0, maxAttempts: JOB_MAX_ATTEMPTS['payroll.requeue_invoice_issues'] },
  },
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
