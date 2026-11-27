import { DEFAULT_AGENT_HOURS, type AgentHours } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { herDayEndsSoon } from '../day-end';

// Tuesday 27/10/2026, Paris (UTC+1): her slot runs from 18:00 to 23:00.
const hours: AgentHours = {
  ...DEFAULT_AGENT_HOURS,
  reply: { mode: 'slots', slots: [{ day: 2, startMinute: 18 * 60, endMinute: 23 * 60, enabled: true }] },
};
const at = (local: string) => new Date(`2026-10-27T${local}:00+01:00`);

describe('herDayEndsSoon (ADR 0158 § A 7)', () => {
  it('says goodbye in the last minutes of her slot, never before nor once it closed', () => {
    expect(herDayEndsSoon(hours, 'Europe/Paris', at('22:50'))).toBe(true);
    expect(herDayEndsSoon(hours, 'Europe/Paris', at('22:30'))).toBe(false);
    expect(herDayEndsSoon(hours, 'Europe/Paris', at('23:05'))).toBe(false);
  });

  it('never ends a day that has no end: always open', () => {
    expect(herDayEndsSoon(DEFAULT_AGENT_HOURS, 'Europe/Paris', at('22:50'))).toBe(false);
  });

  it('ends her day early when an exception closes it', () => {
    const exceptions = [{ date: '2026-10-27', ranges: [{ startMinute: 18 * 60, endMinute: 21 * 60 }] }];
    expect(herDayEndsSoon(hours, 'Europe/Paris', at('20:45'), exceptions)).toBe(true);
  });
});
