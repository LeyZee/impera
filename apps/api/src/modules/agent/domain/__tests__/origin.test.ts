import { MessageOriginSchema } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { originNote } from '../origin';

describe('originNote (ADR 0110)', () => {
  it('says something of every origin, and nothing of a plain message', () => {
    for (const origin of MessageOriginSchema.options) expect(originNote(origin)).toMatch(/\S/u);
    expect(originNote(null)).toBeUndefined();
    expect(originNote(undefined)).toBeUndefined();
  });

  it('tells the brain an opener is not his own words', () => {
    expect(originNote('hook')).toContain('pas ses mots');
  });
});
