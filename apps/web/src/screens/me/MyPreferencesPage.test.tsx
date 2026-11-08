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
});
