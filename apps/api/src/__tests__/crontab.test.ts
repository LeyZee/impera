import { JOB_PAYLOADS, JobNameSchema } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { parsedCronJobs } from '../crontab';

describe('periodic jobs', () => {
  it('accept the payload the cron enqueues, `_cron` included (recette 28/10: the ECB job refused every run)', () => {
    const cron = { _cron: { ts: '2026-10-28T20:07:00.000Z', backfilled: false } };
    for (const item of parsedCronJobs()) {
      const schema = JOB_PAYLOADS[JobNameSchema.parse(item.task)];
      expect(schema.safeParse({ ...(item.payload ?? {}), ...cron }).success, item.task).toBe(true);
    }
  });
});
