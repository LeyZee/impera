import type { Me } from '@impera/contracts';
import { describe, expect, it } from 'vitest';

import { placeOf } from './tab';
import {
  awayLabel,
  awayOf,
  awayTitle,
  firstNameOf,
  initialOf,
  kindLabel,
  kindOf,
  shortcutIconOf,
  shortcutsFor,
  watchesInstagram,
} from './who';

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
  preferences: { sounds: true },
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
    // ADR 0024, amendement du 16/11: the manager no longer has the watch.
    [me({ role: 'operator', team: { role: 'manager', status: 'active' }, teamScope: 'agency' }), false],
    [me({ role: 'operator', team: { role: 'manager', status: 'on_leave' }, teamScope: 'self' }), false],
    [me({ role: 'operator', team: { role: 'chatter', status: 'active' }, teamScope: 'self' }), false],
    [me({ role: 'operator', teamScope: 'self' }), false],
    [me({ role: 'creator', teamScope: 'self' }), false],
  ])('offers the Instagram watch to the owner alone (ADR 0024, amendement du 16/11)', (account, watches) => {
    expect(watchesInstagram(kindOf(account))).toBe(watches);
  });

  // EXT-08: the popup drew « CU » where the CRM's rail draws « C ».
  it('takes the rail’s own initial', () => {
    expect(initialOf({ name: 'Alex de la Morel', email: 'a@exemple.fr' })).toBe('A');
    expect(initialOf({ name: 'élise', email: 'a@exemple.fr' })).toBe('É');
    expect(initialOf({ name: '« Élodie »', email: 'a@exemple.fr' })).toBe('É');
    expect(initialOf({ name: '  ', email: 'zoe@exemple.fr' })).toBe('Z');
  });

  it('greets by the first name', () => {
    expect(firstNameOf({ name: ' Alex Morel ' })).toBe('Alex');
  });

  // Recette du 16/11, EXT-22: « 🌸 Lou 🌸 » gave « Bonsoir, 🌸. » and « 🌸🌸 ». The avatar shows the rail's sign since
  // EXT-08: one emoji, whole, as the CRM shows it.
  it('skips the words that hold no letter in the greeting, and draws one sign only', () => {
    expect(firstNameOf({ name: '🌸 Lou 🌸' })).toBe('Lou');
    expect(initialOf({ name: '🌸 Lou 🌸', email: 'a@exemple.fr' })).toBe('🌸');
    expect(initialOf({ name: '👍🏽 Lou', email: 'a@exemple.fr' })).toBe('👍🏽');
    expect(firstNameOf({ name: '🌸 🌸' })).toBe('');
  });

  // Recette du 16/11, EXT-10: a suspended chatter saw « Connecté » and the copilot.
  it('tells a member away from work, in the words of the CRM', () => {
    const chatter = (status: 'active' | 'suspended' | 'on_leave') =>
      me({ role: 'operator', team: { role: 'chatter', status }, teamScope: 'self' });
    expect(awayOf(chatter('active'))).toBeNull();
    expect(awayOf(me({}))).toBeNull();
    expect(awayOf(chatter('suspended'))).toBe('suspended');
    expect(awayLabel('suspended')).toBe('Suspendu');
    expect(awayTitle('suspended')).toBe('Ton compte est suspendu');
    expect(awayLabel('on_leave')).toBe('En congé');
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

  // Avis Design du 19/11 sur #872: Entraîner wore Suivi's icon and Réglages Moi's.
  it('draws Entraîner and Réglages with their own icons, as the CRM menu does', () => {
    expect(shortcutIconOf('/entrainer')).toBe('train');
    expect(shortcutIconOf('/reglages')).toBe('settings');
    expect(shortcutIconOf('/suivi')).toBe('tracking');
    expect(shortcutIconOf('/moi')).toBe('me');
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
