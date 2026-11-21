import { JOB_MAX_ATTEMPTS } from '@impera/contracts';
import { sql, withTenant, type Database } from '@impera/db';

export interface CaptionJob {
  readonly creatorId: string;
  readonly mediaAssetId: string;
  readonly correlationId: string;
}

/**
 * `instagram_captions.propose` for a medium of hers, keyed by the medium: one waiting job whatever asked for it (each
 * description, a replay); `runAt` puts it off (budget spent), `null` runs it now. Under the app role, in her creator:
 * never the service role.
 */
export function enqueueCaptions(db: Database, job: CaptionJob, runAt: Date | null): Promise<void> {
  return withTenant(db, job.creatorId, async (tx) => {
    await tx.execute(
      sql`select public.enqueue_job(
        task => 'instagram_captions.propose',
        payload => ${JSON.stringify(job)}::jsonb,
        run_at => ${runAt === null ? null : runAt.toISOString()}::timestamptz,
        max_attempts => ${JOB_MAX_ATTEMPTS['instagram_captions.propose']}::int,
        job_key => ${`instagram_captions.propose:${job.mediaAssetId}`},
        job_key_mode => 'replace'
      )`,
    );
  });
}
