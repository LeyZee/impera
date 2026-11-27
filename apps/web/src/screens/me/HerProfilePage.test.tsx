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
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HerProfilePage } from './HerProfilePage';

import { THEO_ME } from '@/test/pay';

// Invented (ADR 0010).
const NORA_ME: Me = {
  ...THEO_ME,
  id: 'creator-user-nora',
  name: 'Nora',
  email: 'nora@example.test',
  role: 'creator',
  team: null,
  teamScope: 'self',
  creatorIds: ['00000000-0000-4000-8000-0000000000aa'],
};
function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/profil',
    component: () => <HerProfilePage user={NORA_ME} />,
  });
  const others = [
    '/moi/persona',
    '/moi/liens',
    '/moi/trophees',
    '/moi/securite',
    '/moi/aide',
    '/moi/preferences',
    '/notifications',
  ].map((path) => createRoute({ getParentRoute: () => root, path, component: () => null }));
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/moi/profil'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Profil, the creator’s (recette visuelle 16/11, CRE-03)', () => {
  it('says who she is in Impera in a few lines, from what her screens already read', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Profil' })).toBeDefined();
    const card = screen.getByRole('heading', { level: 2, name: 'Nora' }).closest('section');
    if (card === null) throw new Error('no card');
    expect(within(card).getByText('nora@example.test')).toBeDefined();
    expect(within(card).getByText('Créatrice')).toBeDefined();
    // Her account is read by every screen: this one asks the server nothing of its own.
    expect(fetch).not.toHaveBeenCalled();
  });

  it('leads to each of her other screens of Moi, one line each, none left out (MOD-07)', async () => {
    renderPage();
    const list = (await screen.findByRole('heading', { level: 2, name: 'Dans Moi' })).closest('section');
    if (list === null) throw new Error('no list');
    expect(
      within(list)
        .getAllByRole('link')
        .map((link) => link.getAttribute('href')),
    ).toEqual([
      '/moi/persona',
      '/moi/liens',
      '/moi/trophees',
      '/moi/securite',
      '/moi/aide',
      '/moi/preferences',
      '/notifications',
    ]);
  });
});
