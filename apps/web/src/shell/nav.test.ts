import type { Me } from '@nirvana/contracts';
import { describe, expect, it } from 'vitest';

import { canOpen, layoutRail, railKindOf, railOf, sectionOf, type Section } from './nav';

const base = { id: 'u1', email: 'membre@example.test', name: 'Nora', creatorIds: [], routedCreatorIds: [] };
const owner: Me = { ...base, role: 'owner', team: null, teamScope: 'owner' };
const manager: Me = {
  ...base,
  role: 'operator',
  team: { role: 'manager', status: 'active' },
  teamScope: 'agency',
};
const chatter: Me = {
  ...base,
  role: 'operator',
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};
const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };
const creator: Me = { ...base, role: 'creator', team: null, teamScope: 'self' };

const all = (): boolean => true;
const labels = (me: Me): string[] => {
  const rail = railOf(me);
  return [...rail.items, ...(rail.settings === null ? [] : [rail.settings])].map(({ label }) => label);
};

describe('railKindOf', () => {
  it('reads the rail from /v1/me, the scope deciding for a manager', () => {
    expect(railKindOf(owner)).toBe('owner');
    expect(railKindOf(manager)).toBe('manager');
    expect(railKindOf(chatter)).toBe('chatter');
    // On leave, a manager reads his own rows only: his rail says the same.
    const away: Me = { ...manager, team: { role: 'manager', status: 'on_leave' }, teamScope: 'self' };
    expect(railKindOf(away)).toBe('chatter');
    expect(railKindOf(operator)).toBe('operator');
    expect(railKindOf(creator)).toBe('creator');
  });
});

describe('layoutRail, once every screen exists', () => {
  it('orders each rail as ADR 0024 does', () => {
    const order = (kind: Parameters<typeof layoutRail>[0]): Section[] => {
      const layout = layoutRail(kind, all);
      return [...layout.sections.map(([to]) => to), ...(layout.settings ? ['/reglages' as const] : [])];
    };
    expect(order('owner')).toEqual([
      '/',
      '/suivi',
      '/entrainer',
      '/equipe',
      '/paie',
      '/creatrices',
      '/reglages',
    ]);
    expect(order('manager')).toEqual(['/', '/suivi', '/equipe', '/paie', '/moi']);
    expect(order('chatter')).toEqual(['/aujourdhui', '/suivi', '/planning', '/commissions', '/moi']);
  });

  it('titles both families of the owner, and puts on « Plus » what his phone has no room for', () => {
    const layout = layoutRail('owner', all);
    expect([...layout.headed]).toEqual(['chatting', 'agency']);
    expect([...layout.more]).toEqual(['/entrainer', '/creatrices', '/reglages']);
  });

  it('keeps five tabs on the bar, without « Plus », for the manager and the chatter', () => {
    expect(layoutRail('manager', all).more.size).toBe(0);
    expect(layoutRail('chatter', all).more.size).toBe(0);
  });

  it('fills the bar from the phone order, then the rail order, when only Équipe is new', () => {
    const layout = layoutRail('owner', (section) => section !== '/paie' && section !== '/moi');
    expect([...layout.more]).toEqual(['/creatrices', '/reglages']);
    expect([...layout.headed]).toEqual(['chatting', 'agency']);
  });
});

describe('railOf, with the screens of today', () => {
  it('shows only the tabs whose screen exists', () => {
    expect(labels(owner)).toEqual([
      'Dashboard',
      'Suivi',
      'Entraîner',
      'Équipe',
      'Paie',
      'Créatrices',
      'Réglages',
    ]);
    // An operator without a team row keeps today's rail: no Équipe.
    // Nor Entraîner: the server keeps the playground to the owner.
    // Nor Réglages: every page of it is the owner's (NAV-18).
    expect(labels(operator)).toEqual(['Dashboard', 'Suivi', 'Créatrices']);
    expect(labels(manager)).toEqual(['Dashboard', 'Suivi', 'Équipe', 'Paie']);
    expect(labels(chatter)).toEqual(['Aujourd’hui', 'Suivi', 'Planning', 'Commissions']);
    // A creator never sees a conversation (ADR 0023): no Suivi. Her Créatrices is her own persona (NAV-18).
    expect(labels(creator)).toEqual(['Dashboard', 'Persona']);
  });

  it('titles Chatting and Agence, and puts what the phone bar cannot hold under « Plus »', () => {
    const rail = railOf(owner);
    expect([...rail.headed]).toEqual(['chatting', 'agency']);
    // The bar keeps Dashboard, Suivi, Équipe and Paie (ADR 0024): Entraîner goes under « Plus » with the rest.
    expect([...rail.more]).toEqual(['/entrainer', '/creatrices', '/reglages']);
  });

  it('titles nothing for an operator, whose Suivi and Créatrices are alone, and needs no « Plus »', () => {
    const rail = railOf(operator);
    expect([...rail.headed]).toEqual([]);
    expect(rail.more.size).toBe(0);
  });

  it('lands each account on its first tab', () => {
    expect(railOf(owner).home).toBe('/');
    expect(railOf(manager).home).toBe('/');
    expect(railOf(chatter).home).toBe('/aujourdhui');
  });
});

describe('sectionOf and canOpen', () => {
  it('finds the section of any address inside it', () => {
    expect(sectionOf('/')).toBe('/');
    expect(sectionOf('/entrainer/playground')).toBe('/entrainer');
    expect(sectionOf('/paie/factures')).toBe('/paie');
    expect(sectionOf('/inconnu')).toBeNull();
  });

  it('lets a chatter open Suivi, and nothing that is not his', () => {
    const rail = railOf(chatter);
    expect(canOpen(rail, '/suivi')).toBe(true);
    expect(canOpen(rail, '/planning')).toBe(true);
    for (const section of ['/', '/entrainer', '/equipe', '/creatrices', '/reglages'] as const) {
      expect(canOpen(rail, section)).toBe(false);
    }
    expect(canOpen(railOf(owner), '/reglages')).toBe(true);
    expect(canOpen(railOf(creator), '/suivi')).toBe(false);
  });
});
