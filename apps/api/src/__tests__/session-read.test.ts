import { APIError } from 'better-auth/api';
import { describe, expect, it } from 'vitest';

import { sessionReadFailed } from '../auth';

describe('sessionReadFailed', () => {
  const passes = (): Promise<unknown> => Promise.resolve();

  it('reads a refused refresh as no session', async () => {
    await expect(sessionReadFailed(new APIError('UNAUTHORIZED'), passes)).resolves.toBeNull();
  });

  it('answers 503, never 500, when the session store failed a moment (IA-09)', async () => {
    const failed = new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to get session' });
    await expect(sessionReadFailed(failed, passes)).rejects.toMatchObject({ statusCode: 503 });
  });

  it('lets the database error go up when the database is down', async () => {
    const down = new Error('Connection terminated');
    const failed = new APIError('INTERNAL_SERVER_ERROR', { message: 'Failed to get session' });
    await expect(sessionReadFailed(failed, () => Promise.reject(down))).rejects.toBe(down);
  });

  it('lets any other error go up as is', async () => {
    const other = new Error('other');
    await expect(sessionReadFailed(other, passes)).rejects.toBe(other);
  });
});
