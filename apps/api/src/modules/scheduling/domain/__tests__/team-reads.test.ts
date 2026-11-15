import { describe, expect, it } from 'vitest';

import { boundCreators, readsTeamSchedule } from '../team-reads';

describe('readsTeamSchedule', () => {
  it('lets the owner and the team’s accounts read, never a creator', () => {
    expect(readsTeamSchedule('owner')).toBe(true);
    expect(readsTeamSchedule('operator')).toBe(true);
    expect(readsTeamSchedule('creator')).toBe(false);
  });
});

describe('boundCreators', () => {
  const existing = ['crt_a', 'crt_b', 'crt_c'];

  it('keeps every creator for `all`, and of a list only those that exist, in the directory’s order', () => {
    expect(boundCreators('all', existing)).toEqual(existing);
    expect(boundCreators(['crt_c', 'crt_gone', 'crt_a'], existing)).toEqual(['crt_a', 'crt_c']);
    expect(boundCreators([], existing)).toEqual([]);
  });
});
