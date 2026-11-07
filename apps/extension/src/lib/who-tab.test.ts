import type { Me } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { placeOf } from './tab';
import { firstNameOf, initialsOf, kindLabel, kindOf, shortcutsFor, watchesInstagram } from './who';

const me = (over: Partial<Me>): Me => ({
  id: 'u1',
  email: 'alex@exemple.fr',
  name: 'Alex Morel',
  role: 'owner',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  team: null,
  teamScope: 'owner',
  ...over,
});

describe('who is signed in', () => {
  it.each([
    [me({}), 'owner', 'Propriétaire'],
    [
      me({ role: 'operator', team: { role: 'manager', status: 'active' }, teamScope: 'agency' }),
      'manager',
      'Manager',
    ],
    [
      me({ role: 'operator', team: { role: 'chatter', status: 'active' }, teamScope: 'self' }),
      'chatter',
      'Chatteur',
    ],
    [me({ role: 'operator', teamScope: 'self' }), 'operator', 'Opérateur'],
    [me({ role: 'creator', teamScope: 'self' }), 'creator', 'Créatrice'],
  ])(
    'reads the kind and names it as the CRM account menu does (AppShell roleLabel)',
    (account, kind, label) => {
      expect(kindOf(account)).toBe(kind);
      expect(kindLabel(kindOf(account))).toBe(label);
    },
  );

  it.each([
    [me({}), true],
    [me({ role: 'operator', team: { role: 'manager', status: 'active' }, teamScope: 'agency' }), true],
    [me({ role: 'operator', team: { role: 'manager', status: 'on_leave' }, teamScope: 'self' }), false],
    [me({ role: 'operator', team: { role: 'chatter', status: 'active' }, teamScope: 'self' }), false],
    [me({ role: 'operator', teamScope: 'self' }), false],
    [me({ role: 'creator', teamScope: 'self' }), false],
  ])(
    'offers the Instagram watch to the owner and an active manager only (ADR 0060 § 2)',
    (account, watches) => {
      expect(watchesInstagram(kindOf(account))).toBe(watches);
    },
  );

  it('takes the initials of the first and last names', () => {
    expect(initialsOf({ name: 'Alex de la Morel', email: 'a@exemple.fr' })).toBe('AM');
    expect(initialsOf({ name: 'élise', email: 'a@exemple.fr' })).toBe('É');
    expect(initialsOf({ name: '  ', email: 'zoe@exemple.fr' })).toBe('Z');
  });

  it('greets by the first name', () => {
    expect(firstNameOf({ name: ' Alex Morel ' })).toBe('Alex');
  });

  it('offers four shortcuts at most, read in the CRM menus (ADR 0066 § 6), the creator her Agenda', () => {
    expect(shortcutsFor('chatter').map((s) => s.path)).toEqual([
      '/aujourdhui',
      '/suivi',
      '/planning',
      '/commissions',
    ]);
    expect(shortcutsFor('creator').map((s) => s.path)).toEqual(['/aujourdhui', '/agenda', '/ventes', '/moi']);
    expect(shortcutsFor('creator')[1]).toEqual({ path: '/agenda', label: 'Agenda', icon: 'planning' });
    for (const kind of ['owner', 'manager', 'chatter', 'operator', 'creator'] as const) {
      expect(shortcutsFor(kind).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('the open tab', () => {
  const crm = 'http://localhost:5173';
  it.each([
    ['https://app.reveal.me/messages', 'reveal'],
    ['https://reveal.me/', 'reveal'],
    ['https://www.instagram.com/reels/', 'instagram'],
    ['http://localhost:5173/suivi', 'crm'],
    ['https://notreveal.me/', 'elsewhere'],
    ['http://app.reveal.me/', 'elsewhere'],
    ['https://reveal.me.exemple.fr/', 'elsewhere'],
    [undefined, 'elsewhere'],
    ['chrome://extensions', 'elsewhere'],
  ])('%s is %s', (url, place) => {
    expect(placeOf(url, crm)).toBe(place);
  });
});
