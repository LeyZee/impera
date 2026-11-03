import { sql, type Database } from '@impera/db';
import type { Task } from 'graphile-worker';
import { z } from 'zod';

import type { Logger } from '../../logger';

/** A task that only exists in tests: it logs its start and end, so queue order and shutdown can be observed. */
export const SLOW_TASK = 'test.slow';

const SlowPayloadSchema = z.object({ seq: z.number().int(), delayMs: z.number().int().min(0) });

export function createSlowTask(logger: Logger): Task {
  return async (raw) => {
    const { seq, delayMs } = SlowPayloadSchema.parse(raw);
    logger.info({ seq, at: Date.now() }, 'slow started');
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    logger.info({ seq, at: Date.now() }, 'slow finished');
  };
}

/** Enqueues it straight through Graphile's SQL function, as the owner role. */
export async function enqueueSlow(
  admin: Database,
  seq: number,
  delayMs: number,
  queueName: string,
): Promise<void> {
  await admin.execute(
    sql`select graphile_worker.add_job(${SLOW_TASK}, json_build_object('seq', ${seq}::int, 'delayMs', ${delayMs}::int), queue_name => ${queueName})`,
  );
}
