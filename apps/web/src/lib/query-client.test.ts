import { describe, expect, it } from 'vitest';

import { createQueryClient, READ_RETRIES } from './query-client';

describe('the query client (ETA-15)', () => {
  it('tries a read again once by default, on every screen alike', () => {
    expect(READ_RETRIES).toBe(1);
    expect(createQueryClient().getDefaultOptions().queries?.retry).toBe(1);
  });
});
