// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FirstWelcome, welcomeRoleOf, type WelcomeRole } from './FirstWelcome';

/** Invented accounts only. */
const base: Me = {
  id: 'u-1',
  email: 'theo@example.test',
  name: 'Théo Test',
  role: 'operator',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
  preferences: { sounds: true },
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('null', { status: 404 }))),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(user: Me, role: WelcomeRole): ReturnType<typeof vi.fn> {
  const onGo = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FirstWelcome user={user} role={role} onGo={onGo} />
    </QueryClientProvider>,
  );
  return onGo;
}

describe('the welcome of a first sign-in (recette 27/11, P1)', () => {
  it('greets the chatter by his first name and starts with the extension', () => {
    const onGo = show(base, 'chatter');
    expect(screen.getByRole('heading', { name: 'Bienvenue, Théo' })).toBeTruthy();
    expect(screen.getByText('Installe l’extension Impera')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Commencer par l’extension' }));
    expect(onGo).toHaveBeenCalledWith('/aide/extension');
  });

  it('gives the model her three settings, and opens her day', () => {
    const onGo = show({ ...base, name: 'Nora', role: 'creator', team: null }, 'creator');
    expect(screen.getByText('Active les notifications')).toBeTruthy();
    expect(screen.getByText('Connexion avec Face ID')).toBeTruthy();
    // Impera on her home screen before the notifications: on an iPhone they only arrive there (MOD-03, 27/11).
    const steps = [...document.querySelectorAll('.fw__step b')].map((step) => step.textContent);
    expect(steps).toEqual([
      'Connexion avec Face ID',
      'Mets Impera sur ton écran d’accueil',
      'Active les notifications',
    ]);
    expect(screen.getByText('Ce qui n’est pas fait t’attendra dans Moi › Préférences.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voir ma journée' }));
    expect(onGo).toHaveBeenCalledWith('/aujourdhui');
  });

  it('tells the manager where to look and what stays the owner’s', () => {
    const onGo = show({ ...base, name: 'Inès', team: { role: 'manager', status: 'active' } }, 'manager');
    expect(screen.getByText('Le propriétaire')).toBeTruthy();
    expect(screen.getByText('Primes, prix, paie')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir le Dashboard' }));
    expect(onGo).toHaveBeenCalledWith('/');
  });

  it('welcomes a model, a chatter and a manager, never the owner', () => {
    expect(welcomeRoleOf({ ...base, role: 'owner' })).toBeNull();
    expect(welcomeRoleOf({ ...base, role: 'creator', team: null })).toBe('creator');
    expect(welcomeRoleOf(base)).toBe('chatter');
    expect(welcomeRoleOf({ ...base, team: { role: 'manager', status: 'active' } })).toBe('manager');
  });
});
