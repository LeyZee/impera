import { describe, expect, it } from 'vitest';

import { countLine, holderLine, paidLines, shortWhen, shownStates } from './model';

const NOW = new Date('2026-11-16T12:00:00Z');
const ago = (minutes: number): string => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe('the words of the list of fans (ADR 0124, avis Design 16/11)', () => {
  it('says each currency as it is, and « — » for nothing', () => {
    expect(paidLines({ eurMinor: 0, usdMinor: 0 })).toEqual(['—']);
    expect(paidLines({ eurMinor: 12_050, usdMinor: 0 })).toEqual(['120,50\u00a0€']);
    expect(paidLines({ eurMinor: 1000, usdMinor: 1500 })).toEqual(['10,00\u00a0€', '15,00\u00a0$US']);
  });

  it('says a moment short: minutes, hours, days, then the day', () => {
    expect(shortWhen(null, NOW)).toBe('—');
    expect(shortWhen(ago(0), NOW)).toBe('à l’instant');
    expect(shortWhen(ago(12), NOW)).toBe('il y a 12 min');
    expect(shortWhen(ago(3 * 60), NOW)).toBe('il y a 3 h');
    expect(shortWhen(ago(4 * 24 * 60), NOW)).toBe('il y a 4 j');
    expect(shortWhen('2026-10-02T10:00:00Z', NOW)).toBe('2 oct.');
    expect(shortWhen('2025-10-02T10:00:00Z', NOW)).toBe('2 oct. 2025');
  });

  it('shows two states at most, the urgent first, and counts the others', () => {
    expect(shownStates(['care', 'sales_frozen', 'age_disputed'])).toEqual({
      shown: ['age_disputed', 'care'],
      more: 1,
    });
    expect(shownStates([])).toEqual({ shown: [], more: 0 });
  });

  it('names who holds him, the member when a human does', () => {
    expect(holderLine({ holder: 'agent', holderName: null })).toBe('Agent');
    expect(holderLine({ holder: 'human', holderName: 'Maya' })).toBe('Maya');
    expect(holderLine({ holder: 'human', holderName: null })).toBe('Un humain');
    expect(holderLine({ holder: 'none', holderName: null })).toBe('—');
  });

  it('counts the fans in words', () => {
    expect(countLine(1)).toBe('1 fan');
    expect(countLine(42)).toBe('42 fans');
  });
});
