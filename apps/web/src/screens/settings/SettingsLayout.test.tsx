// @vitest-environment jsdom
import type { Me } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '@/router';

/* Invented members: no real person. */
const base = { id: 'u1', email: 'membre@example.test', name: 'Nora', creatorIds: [], routedCreatorIds: [] };
const owner: Me = { ...base, role: 'owner', team: null, teamScope: 'owner' };

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  // The pages stay on their loading state: only the tabs are under test.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settingsTabs(user: Me): Promise<string[]> {
  const router = createAppRouter(
    { user, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: ['/reglages/modeles-ia'] }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  const nav = await screen.findByRole('navigation', { name: 'Réglages' });
  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);
}

describe('Réglages tabs', () => {
  it('gives Telegram to the owner, whom the server serves it to', async () => {
    expect(await settingsTabs(owner)).toContain('Telegram');
  });

  it('keeps Apparence and « Se déconnecter » out of the tabs: both live in the account menu (NAV-03)', async () => {
    const tabs = await settingsTabs(owner);
    expect(tabs).not.toContain('Apparence');
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
  });

  it('gives no tab to Appareils nor Mode de l’agent while their screens only say « à venir »', async () => {
    const tabs = await settingsTabs(owner);
    expect(tabs).not.toContain('Appareils');
    expect(tabs).not.toContain('Mode de l’agent');
  });
});
