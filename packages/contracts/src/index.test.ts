import { describe, expect, it } from 'vitest';

import { CONTRACTS_PACKAGE } from './index';

describe('@impera/contracts', () => {
  it('resolves through the workspace', () => {
    expect(CONTRACTS_PACKAGE).toBe('@impera/contracts');
  });
});
