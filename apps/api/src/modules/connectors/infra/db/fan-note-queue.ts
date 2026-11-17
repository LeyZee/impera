import { JOB_MAX_ATTEMPTS, JOB_PAYLOADS, type CreatorId, type FanId } from '@impera/contracts';
import { sql, type Database } from '@impera/db';

/** Facts often change in bursts: the note waits this long after the last change (ADR 0117 § 5). */
const FAN_NOTE_DELAY_SECONDS = 120;

/**
 * `connector.sync_fan_note` for one fan, with the owner role (his facts were written in another transaction): one
 * waiting per fan (`job_key`, its time pushed back by each change), one running at a time (`queue_name`).
 */
export async function enqueueFanNoteSync(
  adminDb: Database,
  creatorId: CreatorId,
  fanId: FanId,
  correlationId: string,
): Promise<void> {
  const payload: unknown = JOB_PAYLOADS['connector.sync_fan_note'].parse({ creatorId, fanId, correlationId });
  await adminDb.execute(
    sql`select public.enqueue_job(
      task => 'connector.sync_fan_note',
      payload => ${JSON.stringify(payload)}::jsonb,
      queue_name => ${`fan-note:${fanId}`},
      run_at => now() + make_interval(secs => ${FAN_NOTE_DELAY_SECONDS}),
      max_attempts => ${JOB_MAX_ATTEMPTS['connector.sync_fan_note']}::int,
      job_key => ${`connector.sync_fan_note:${fanId}`},
      job_key_mode => 'replace'
    )`,
  );
}
