import { describe, expect, it } from 'vitest';

import { distinctNames } from './names';

/* Invented creators: no real person. */
const creator = (id: string, displayName: string) => ({ id, displayName });

describe('creator names on a chip', () => {
  it('numbers the creators who share a name by creation order, and leaves the others alone', () => {
    const named = distinctNames(
      [
        creator('0192f3a0-0000-7000-8000-0000000000c3', 'Doublon'),
        creator('0192f3a0-0000-7000-8000-0000000000c1', 'Nora'),
        creator('0192f3a0-0000-7000-8000-0000000000c2', 'doublon '),
      ],
      (c) => c.id,
    );
    expect(named.map((c) => c.displayName)).toEqual(['Doublon · 2', 'Nora', 'doublon · 1']);
  });
});
