import { describe, expect, it } from 'vitest';

import { shotMoment } from '../shot-moment';

describe('the moment a script is shot as (« ok alternance »)', () => {
  it('keeps a day or a night structure as it is, whatever came before', () => {
    expect(shotMoment('day', 'day')).toBe('day');
    expect(shotMoment('night', null)).toBe('night');
  });

  it('alternates a « both » structure with her last script, night for her first', () => {
    expect(shotMoment('both', null)).toBe('night');
    expect(shotMoment('both', 'night')).toBe('day');
    expect(shotMoment('both', 'day')).toBe('night');
  });
});
