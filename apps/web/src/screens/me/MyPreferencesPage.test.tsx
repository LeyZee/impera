// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyPreferencesPage } from './MyPreferencesPage';

import { IRIS_ME, OWNER, THEO_ME } from '@/test/pay';

// Invented (ADR 0010).
const NORA_ME: Me = {
  ...THEO_ME,
  id: 'creator-user-nora',
  name: 'Nora',
  role: 'creator',
  team: null,
  teamScope: 'self',
  creatorIds: ['00000000-0000-4000-8000-0000000000aa'],
  preferences: { sounds: true },
};

function renderPage(onSignOut: () => void, user: Me = THEO_ME): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/preferences',
    component: () => <MyPreferencesPage user={user} onSignOut={onSignOut} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/moi/preferences'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Préférences (D-03)', () => {
  it('holds what « Plus » held on the phone: the appearance, the notifications, the way out', async () => {
    const onSignOut = vi.fn();
    renderPage(onSignOut);
    expect(await screen.findByRole('heading', { name: 'Préférences', level: 1 })).toBeTruthy();
    expect(screen.getByRole('radiogroup')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Régler mes notifications' }).getAttribute('href')).toBe(
      '/notifications',
    );
    expect(screen.getByRole('link', { name: 'Préférences' }).getAttribute('href')).toBe('/moi/preferences');
    // The address of the account under its name, beside the way out (recette visuelle 16/11, CRE-20).
    expect(screen.getByText(THEO_ME.email)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Se déconnecter' }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('gives those who see her media « Flou des médias » beside the appearance, never a chatter (SC-04 lot c4)', async () => {
    for (const user of [OWNER, IRIS_ME]) {
      renderPage(vi.fn(), user);
      expect(await screen.findByRole('switch', { name: 'Flou des médias' })).toBeTruthy();
      cleanup();
    }
    renderPage(vi.fn());
    await screen.findByRole('heading', { name: 'Préférences', level: 1 });
    expect(screen.queryByRole('switch', { name: 'Flou des médias' })).toBeNull();
  });

  // Recette 11/11 (CRE-29): once the install card was set aside, nothing led back to the guide.
  it('keeps the way to install Impera, except in the installed app', async () => {
    renderPage(vi.fn());
    const install = await screen.findByRole('link', { name: 'Installer Impera' });
    expect(install.getAttribute('href')).toBe('/aide/installer');
    cleanup();
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(display-mode: standalone)',
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    renderPage(vi.fn());
    await screen.findByRole('heading', { name: 'Préférences', level: 1 });
    expect(screen.queryByRole('link', { name: 'Installer Impera' })).toBeNull();
  });

  it('gives a chatter « Sons », kept with the account, and nobody who does not play (ADR 0104 § 19)', async () => {
    const calls: [string, unknown][] = [];
    vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
      calls.push([url, init?.body === undefined ? null : JSON.parse(init.body)]);
      return Promise.resolve(new Response(JSON.stringify({ sounds: false }), { status: 200 }));
    });
    renderPage(vi.fn());
    const sounds = await screen.findByRole('switch', { name: 'Sons : activés' });
    fireEvent.click(sounds);
    expect(await screen.findByRole('switch', { name: 'Sons : coupés' })).toBeTruthy();
    expect(calls).toEqual([['/v1/me/preferences', { sounds: false }]]);
    cleanup();
    for (const user of [OWNER, IRIS_ME]) {
      renderPage(vi.fn(), user);
      await screen.findByRole('heading', { name: 'Préférences', level: 1 });
      expect(screen.queryByRole('switch', { name: /^Sons/u })).toBeNull();
      cleanup();
    }
  });

  it('gives a creator « Sons » too, for her reveals (ADR 0107 § 11, recette 16/11 CRE-01)', async () => {
    const calls: [string, unknown][] = [];
    vi.stubGlobal('fetch', (url: string, init?: { body?: string }) => {
      calls.push([url, init?.body === undefined ? null : JSON.parse(init.body)]);
      return Promise.resolve(new Response(JSON.stringify({ sounds: false }), { status: 200 }));
    });
    renderPage(vi.fn(), NORA_ME);
    expect(
      await screen.findByText('Le carillon qui accompagne une médaille ou un trophée gagné.'),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Sons : activés' }));
    expect(await screen.findByRole('switch', { name: 'Sons : coupés' })).toBeTruthy();
    expect(calls).toEqual([['/v1/me/preferences', { sounds: false }]]);
  });

  it('puts « Sons » back as it was when the server does not take the change', async () => {
    vi.stubGlobal('fetch', () => Promise.resolve(new Response('', { status: 503 })));
    renderPage(vi.fn());
    fireEvent.click(await screen.findByRole('switch', { name: 'Sons : activés' }));
    expect(await screen.findByRole('switch', { name: 'Sons : activés' })).toBeTruthy();
  });
});
