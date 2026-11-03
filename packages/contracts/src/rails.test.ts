import { describe, expect, it } from 'vitest';

import { CRM_RAILS, CRM_SECTIONS, POPUP_SHORTCUTS_MAX, railKindOf, type RailKind } from './rails';

const KINDS = Object.keys(CRM_RAILS);

describe('the table of the CRM menus (ADR 0024, ADR 0066 § 6)', () => {
  it.each(Object.entries(CRM_RAILS))(
    'offers %s only shortcuts from its own menu, four at most',
    (_, plan) => {
      const menu = new Set(plan.sections.map(([section]) => section));
      for (const shortcut of plan.shortcuts) expect(menu.has(shortcut)).toBe(true);
      expect(plan.shortcuts.length).toBeLessThanOrEqual(POPUP_SHORTCUTS_MAX);
      expect(new Set(plan.shortcuts).size).toBe(plan.shortcuts.length);
    },
  );

  it.each(Object.entries(CRM_RAILS))('keeps on the phone bar of %s only sections of its menu', (_, plan) => {
    const menu = new Set(plan.sections.map(([section]) => section));
    for (const section of plan.phone) expect(menu.has(section)).toBe(true);
  });

  it('lists every section once, Réglages kept apart from the menus', () => {
    expect(new Set(CRM_SECTIONS).size).toBe(CRM_SECTIONS.length);
    for (const plan of Object.values(CRM_RAILS))
      expect(plan.sections.some(([section]) => section === '/reglages')).toBe(false);
  });

  it('offers the creator her Agenda (CR-05), the shortcuts of the other roles unchanged', () => {
    const shortcuts = (kind: RailKind): readonly string[] => CRM_RAILS[kind].shortcuts;
    expect(shortcuts('creator')).toEqual(['/aujourdhui', '/agenda', '/ventes', '/moi']);
    expect(shortcuts('owner')).toEqual(['/', '/suivi', '/equipe', '/creatrices']);
    expect(shortcuts('manager')).toEqual(['/', '/suivi', '/equipe', '/paie']);
    expect(shortcuts('chatter')).toEqual(['/aujourdhui', '/suivi', '/planning', '/commissions']);
  });

  it.each([
    [{ role: 'owner', teamScope: 'owner', team: null }, 'owner'],
    [{ role: 'creator', teamScope: 'self', team: null }, 'creator'],
    [{ role: 'operator', teamScope: 'agency', team: { role: 'manager', status: 'active' } }, 'manager'],
    [{ role: 'operator', teamScope: 'self', team: { role: 'chatter', status: 'active' } }, 'chatter'],
    [{ role: 'operator', teamScope: 'self', team: null }, 'operator'],
  ] as const)('gives %o the %s menu', (me, kind) => {
    expect(railKindOf(me)).toBe(kind);
    expect(KINDS).toContain(kind);
  });
});
