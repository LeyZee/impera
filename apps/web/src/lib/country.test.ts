import { describe, expect, it } from 'vitest';

import { countryFlag, countryName } from './country';

describe('country', () => {
  it('names a member’s country in French and draws its flag', () => {
    expect(countryName('BJ')).toBe('Bénin');
    expect(countryName('MG')).toBe('Madagascar');
    expect(countryFlag('FR')).toBe('🇫🇷');
    expect(countryFlag('bj')).toBe('🇧🇯');
  });
});
