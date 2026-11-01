// @vitest-environment jsdom
import type { Me } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '@/router';

/* An invented owner: no real person. */
const owner: Me = {
  id: 'u1',
  email: 'membre@example.test',
  name: 'Nora',
  creatorIds: [],
  routedCreatorIds: [],
  role: 'owner',
  team: null,
  teamScope: 'owner',
};

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
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  // The Playground stays on its loading state: only the header is under test.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Entraîner header', () => {
  it('shows no tab bar while the Playground is its only screen (ADR 0024)', async () => {
    const router = createAppRouter(
      { user: owner, onSignOut: () => undefined },
      createMemoryHistory({ initialEntries: ['/entrainer/playground'] }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Entraîner' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Entraîner' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Corrections' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tests' })).toBeNull();
  });
});
