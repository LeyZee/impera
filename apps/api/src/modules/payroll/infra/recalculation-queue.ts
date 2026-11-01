import { JOB_MAX_ATTEMPTS, type PayPeriod } from '@nirvana/contracts';
import { sql, type Transaction } from '@nirvana/db';

/**
 * `payroll.recalculate` for `period`, once the transaction commits (EQ-04): one waiting job per period, replaced by the
 * next write, a few seconds later so that a batch of writes gives one run. Each write pushes the run back: a series
 * that never stopped would never run, and `payroll.recalculate_open` computes the period every hour anyway. Pay owns
 * the job: the planning enqueues it through this function, which the composition root gives it, so that one key and
 * one number of attempts serve every writer.
 */
export async function enqueuePayRecalculation(tx: Transaction, period: PayPeriod): Promise<void> {
  await tx.execute(
    sql`select public.enqueue_job(
      task => 'payroll.recalculate',
      payload => ${JSON.stringify({ period })}::jsonb,
      run_at => now() + interval '5 seconds',
      max_attempts => ${JOB_MAX_ATTEMPTS['payroll.recalculate']}::int,
      job_key => ${`payroll.recalculate:${period}`},
      job_key_mode => 'replace'
    )`,
  );
}
