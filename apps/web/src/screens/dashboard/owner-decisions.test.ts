import { describe, expect, it } from 'vitest';

import { dueOf } from './owner-decisions';

const NOW = new Date('2026-11-26T15:00:00Z');

describe('when a question ends, for the owner (INS-05)', () => {
  it('turns amber under two hours, in minutes then hours', () => {
    expect(dueOf('2026-11-26T15:40:00Z', NOW, 'Europe/Paris')).toEqual({
      label: 'Plus que 40 min',
      soon: true,
    });
    expect(dueOf('2026-11-26T16:30:00Z', NOW, 'Europe/Paris')).toEqual({ label: 'Plus que 2 h', soon: true });
  });

  it('says the hour today, tomorrow, or the day', () => {
    expect(dueOf('2026-11-26T19:30:00Z', NOW, 'Europe/Paris')).toEqual({
      label: 'Jusqu’à 20 h 30',
      soon: false,
    });
    expect(dueOf('2026-11-27T08:00:00Z', NOW, 'Europe/Paris')).toEqual({
      label: 'Jusqu’à demain 09 h 00',
      soon: false,
    });
    expect(dueOf('2026-11-29T08:00:00Z', NOW, 'Europe/Paris')).toEqual({
      label: 'Jusqu’au 29 novembre',
      soon: false,
    });
  });
});
