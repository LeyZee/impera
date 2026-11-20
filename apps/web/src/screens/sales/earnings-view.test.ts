import { describe, expect, it } from 'vitest';

import { periodName } from './earnings-view';

describe('periodName (CR-04)', () => {
  it('names a day, a fortnight and a month as she reads them', () => {
    expect(periodName({ period: 'day', from: '2026-11-03', to: '2026-11-03' }, '2026-11-03')).toBe(
      'Aujourd’hui',
    );
    expect(periodName({ period: 'day', from: '2026-11-02', to: '2026-11-02' }, '2026-11-03')).toBe('Hier');
    expect(periodName({ period: 'fortnight', from: '2026-10-01', to: '2026-10-15' }, '2026-11-03')).toBe(
      '1er – 15 oct.',
    );
    expect(periodName({ period: 'fortnight', from: '2026-10-16', to: '2026-10-31' }, '2026-11-03')).toBe(
      '16 – 31 oct.',
    );
    expect(periodName({ period: 'month', from: '2026-10-01', to: '2026-10-31' }, '2026-11-03')).toBe(
      'octobre 2026',
    );
  });
});
