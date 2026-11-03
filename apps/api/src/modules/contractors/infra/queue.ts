import { JOB_MAX_ATTEMPTS } from '@impera/contracts';
import { sql, type Transaction } from '@impera/db';

/**
 * `payroll.lock_payout_certificate` for a transfer that relied on a tax residence certificate (ADR 0041 § 6), in the
 * transaction that records it: once it commits, the certificate's lock is lengthened in both buckets, outside the
 * request, so that a bucket that does not answer never refuses a transfer.
 */
export async function enqueuePayoutCertificateLock(tx: Transaction, statementId: string): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.lock_payout_certificate',
      payload => ${JSON.stringify({ statementId })}::jsonb,
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.lock_payout_certificate']}::int,
      job_key => ${`payroll.lock_payout_certificate:${statementId}`},
      job_key_mode => 'replace'
    )`,
  );
}
