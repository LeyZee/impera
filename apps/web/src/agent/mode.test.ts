import { describe, expect, it } from 'vitest';

import { isSelectable, missingRows, nextMode, pillOf, type AutomaticGate } from './mode';

const closed: AutomaticGate = {
  open: false,
  missing: [
    { kind: 'live_rate', value: 64, target: 80 },
    { kind: 'decided_drafts', value: 37, target: 100 },
    { kind: 'blind_test' },
  ],
};
const open: AutomaticGate = { open: true, missing: [] };

describe('missingRows', () => {
  it('gives one row per missing condition of ADR 0019, with the figures the server measured', () => {
    expect(missingRows(closed)).toEqual([
      ['Taux en réel', '64\u00a0% sur 80\u00a0%'],
      ['Brouillons validés ou refusés', '37 sur 100'],
      ['Test à l’aveugle', 'pas encore validé'],
    ]);
  });

  it('says first that she has no active persona (recette 28/10, G4)', () => {
    expect(
      missingRows({ open: false, missing: [{ kind: 'active_persona' }, { kind: 'blind_test' }] }),
    ).toEqual([
      ['Persona', 'aucune version active'],
      ['Test à l’aveugle', 'pas encore validé'],
    ]);
  });

  it('writes the tenth the server measured the French way', () => {
    expect(missingRows({ open: false, missing: [{ kind: 'live_rate', value: 64.5, target: 80 }] })).toEqual([
      ['Taux en réel', '64,5\u00a0% sur 80\u00a0%'],
    ]);
  });

  it('says when the live rate has not been measured yet', () => {
    expect(missingRows({ open: false, missing: [{ kind: 'live_rate', value: null, target: 80 }] })).toEqual([
      ['Taux en réel', 'pas encore mesuré, 80\u00a0% visés'],
    ]);
  });

  it('has nothing to show when Automatique is open', () => {
    expect(missingRows(open)).toEqual([]);
  });
});

describe('isSelectable', () => {
  it('offers Automatique only when the server opened it, the others always', () => {
    expect(isSelectable('auto', closed)).toBe(false);
    expect(isSelectable('auto', open)).toBe(true);
    expect(isSelectable('copilot', closed)).toBe(true);
    expect(isSelectable('stop', closed)).toBe(true);
  });
});

describe('nextMode', () => {
  it('moves with the arrows and stops at the edges', () => {
    expect(nextMode('copilot', 1, open)).toBe('stop');
    expect(nextMode('copilot', -1, open)).toBe('auto');
    expect(nextMode('stop', 1, open)).toBe('stop');
    expect(nextMode('auto', -1, open)).toBe('auto');
  });

  it('skips a closed Automatique, and never wraps from Copilote onto Arrêt (recette 28/10, M6)', () => {
    expect(nextMode('stop', -1, closed)).toBe('copilot');
    expect(nextMode('copilot', -1, closed)).toBe('copilot');
  });
});

describe('pillOf', () => {
  it('says what the agent does in the control’s words, amber when it is stopped, never red (NAV-06)', () => {
    expect(pillOf('copilot')).toEqual({ label: 'Copilote', tone: 'ok', live: true });
    expect(pillOf('auto')).toEqual({ label: 'Automatique', tone: 'ok', live: true });
    expect(pillOf('stop')).toEqual({ label: 'Arrêt', tone: 'warn', live: false });
  });

  it('keeps the mode set but neither green nor alive when nothing runs', () => {
    expect(pillOf('copilot', false)).toEqual({ label: 'Copilote', tone: 'unknown', live: false });
    expect(pillOf('auto', false)).toEqual({ label: 'Automatique', tone: 'unknown', live: false });
    expect(pillOf('stop', false)).toEqual({ label: 'Arrêt', tone: 'warn', live: false });
  });

  it('never shows a mode the server did not give', () => {
    expect(pillOf(null)).toEqual({ label: 'Injoignable', tone: 'unknown', live: false });
  });
});
