import { GUARD_CODES } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { GUARD_LABELS } from './guards';

describe('GUARD_LABELS', () => {
  it('names every guard of the contracts, and nothing else', () => {
    expect(Object.keys(GUARD_LABELS).toSorted()).toEqual([...GUARD_CODES].toSorted());
    for (const code of GUARD_CODES) expect(GUARD_LABELS[code].length).toBeGreaterThan(0);
  });
});
