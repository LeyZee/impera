import { JOB_MAX_ATTEMPTS, JOB_PAYLOADS, JobNameSchema } from '@impera/contracts';
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

  it('take their attempts from the contract, so a promised retry happens (the evening digest had one try)', () => {
    for (const item of parsedCronJobs()) {
      const task = JobNameSchema.parse(item.task);
      expect(item.options.maxAttempts, task).toBe(JOB_MAX_ATTEMPTS[task]);
    }
  });

  it('keeps of Telegram only the channels’ polling: the alerts ring by Impera notifications (27/11/2026)', () => {
    const tasks = parsedCronJobs().map((item) => item.task);
    expect(tasks.filter((task) => task.startsWith('telegram.'))).toEqual(['telegram.dispatch_polls']);
    expect(tasks).toEqual(expect.arrayContaining(['alerts.agency', 'alerts.remind_safety']));
  });

  it('no longer asks the identities of her native scripts each hour: the agent reads ours (ADR 0161 § 5)', () => {
    expect(parsedCronJobs().map((item) => item.task)).not.toContain('scripts.identify_backlog');
  });
});
