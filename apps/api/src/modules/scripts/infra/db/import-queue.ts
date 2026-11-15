import { accountQueueNameFor, JOB_MAX_ATTEMPTS, JOB_PAYLOADS, type JobPayload } from '@impera/contracts';
import { sql, type Database } from '@impera/db';

/**
 * Queues `scripts.import_platform_scripts` for one account, as the owner role (`public.enqueue_job`), on the
 * account's own queue: after the vault sync queued just before it, so that the links of its media are read fresh. One
 * waiting import per account (`job_key`).
 */
export function createImportQueue(adminDb: Database) {
  return async (request: JobPayload<'scripts.import_platform_scripts'>): Promise<void> => {
    const payload = JOB_PAYLOADS['scripts.import_platform_scripts'].parse(request);
    await adminDb.execute(
      sql`select public.enqueue_job(
        task => 'scripts.import_platform_scripts',
        payload => ${JSON.stringify(payload)}::jsonb,
        queue_name => ${accountQueueNameFor(payload.platformAccountId)},
        max_attempts => ${JOB_MAX_ATTEMPTS['scripts.import_platform_scripts']}::int,
        job_key => ${`scripts:${payload.platformAccountId}`},
        job_key_mode => 'replace'
      )`,
    );
  };
}
