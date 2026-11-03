import { describe, expect, it } from 'vitest';

import { saveDecision } from '../versions';

describe('saveDecision (rule 6)', () => {
  it('changes the latest version while it is not frozen', () => {
    expect(saveDecision({ version: 2, frozen: false }, 2)).toBe('update');
  });

  it('writes the next version over a frozen one', () => {
    expect(saveDecision({ version: 2, frozen: true }, 2)).toBe('insert');
  });

  it('refuses a save over an older version', () => {
    expect(saveDecision({ version: 3, frozen: false }, 2)).toBe('stale');
    expect(saveDecision({ version: 3, frozen: true }, 2)).toBe('stale');
  });
});
