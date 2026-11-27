import { describe, expect, it } from 'vitest';

import { clockText, parseClock } from './SessionReminder';

describe('the hour of « Reconnexion Reveal »', () => {
  it('says a minute of the day as the card does', () => {
    expect(clockText(1080)).toBe('18 h');
    expect(clockText(1110)).toBe('18 h 30');
    expect(clockText(5)).toBe('0 h 05');
  });

  it('reads the ways an hour is typed, and nothing else', () => {
    expect(parseClock('18')).toBe(1080);
    expect(parseClock(' 18 h ')).toBe(1080);
    expect(parseClock('18h30')).toBe(1110);
    expect(parseClock('18 h 30')).toBe(1110);
    expect(parseClock('18:30')).toBe(1110);
    expect(parseClock('18.30')).toBe(1110);
    expect(parseClock('7H05')).toBe(425);
    expect(parseClock('0 h')).toBe(0);
    expect(parseClock('24')).toBeNull();
    expect(parseClock('18:60')).toBeNull();
    expect(parseClock('18:3')).toBeNull();
    expect(parseClock('six heures')).toBeNull();
    expect(parseClock('')).toBeNull();
  });
});
