import type { Me } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { sheetsFor } from './search';

const member = (over: Pick<Me, 'role' | 'teamScope'>): Pick<Me, 'role' | 'teamScope'> => over;

describe('the sheets of a creator a member opens', () => {
  it('opens every sheet to the owner, her ideas of the day included', () => {
    expect(sheetsFor(member({ role: 'owner', teamScope: 'owner' }))).toContain('ideas');
  });

  it('opens her ideas of the day to an active manager', () => {
    expect(sheetsFor(member({ role: 'operator', teamScope: 'agency' }))).toEqual([
      'agenda',
      'ideas',
      'requests',
      'scripts',
    ]);
  });

  it('never shows the watch to a chatter, nor to a manager away or gone (ADR 0060 § 2, amended 07/11)', () => {
    // The server derives `self` for both; the persona alone is left, with no « Idées du jour » nor « Coller un lien ».
    expect(sheetsFor(member({ role: 'operator', teamScope: 'self' }))).toEqual(['persona']);
  });
});
