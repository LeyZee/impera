import { JOB_MAX_ATTEMPTS, JOB_PAYLOADS, JobNameSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { parsedCronJobs, SCAN_SAFETY_NET_ATTEMPTS } from '../crontab';

describe('periodic jobs', () => {
  it('accept the payload the cron enqueues, `_cron` included (recette 28/10: the ECB job refused every run)', () => {
    const cron = { _cron: { ts: '2026-10-28T20:07:00.000Z', backfilled: false } };
    for (const item of parsedCronJobs()) {
      const schema = JOB_PAYLOADS[JobNameSchema.parse(item.task)];
      expect(schema.safeParse({ ...(item.payload ?? {}), ...cron }).success, item.task).toBe(true);
    }
  });

  it('take their attempts from the contract, so a promised retry happens (the evening digest had one try)', () => {
    for (const item of parsedCronJobs()) {
      const task = JobNameSchema.parse(item.task);
      const expected = task === 'telegram.scan' ? SCAN_SAFETY_NET_ATTEMPTS : JOB_MAX_ATTEMPTS[task];
      expect(item.options.maxAttempts, task).toBe(expected);
    }
  });
});
