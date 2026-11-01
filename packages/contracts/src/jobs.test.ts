import { describe, expect, it } from 'vitest';

import {
  accountQueueNameFor,
  JOB_NAMES,
  JOB_PAYLOADS,
  jobKeyFor,
  queueNameFor,
  RESUME_SPACING_SECONDS,
  resumeRunAt,
} from './jobs';

describe('jobs', () => {
  it('has one payload schema per job name', () => {
    expect(Object.keys(JOB_PAYLOADS).sort()).toEqual([...JOB_NAMES].sort());
  });

  it('names the serial queues and the debounce keys', () => {
    expect(queueNameFor('c1')).toBe('conv:c1');
    expect(accountQueueNameFor('a1')).toBe('account:a1');
    expect(jobKeyFor('conversation.respond', 'c1')).toBe('conversation.respond:c1');
  });

  it('spaces the answers owed after a stop, the first right away', () => {
    const now = new Date('2026-10-25T12:00:00Z');
    expect(resumeRunAt(0, now)).toEqual(now);
    expect(resumeRunAt(2, now).getTime() - now.getTime()).toBe(2 * RESUME_SPACING_SECONDS * 1_000);
  });
});
