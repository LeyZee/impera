import { describe, expect, it } from 'vitest';

import { riskCauseOf } from '../hold';

describe('riskCauseOf (recette AGE-02)', () => {
  it('names the gravest risk the brain read', () => {
    expect(riskCauseOf(['dangerous_request', 'minor_suspected'])).toBe('minor');
    expect(riskCauseOf(['real_abuse'])).toBe('non_consent');
    expect(riskCauseOf(['dangerous_request'])).toBe('other');
    expect(riskCauseOf(['brain'])).toBe('other');
  });
});
