// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '@/router';

/* An invented owner: no real person. */
const owner: Me = {
  id: 'u1',
  email: 'membre@example.test',
  name: 'Nora',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  role: 'owner',
  team: null,
  teamScope: 'owner',
  preferences: { sounds: true },
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
  it('shows the two modes, Chatting and the post of her channel, as tabs, and no tab for screens to come (ADR 0024)', async () => {
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
    const tabs = screen.getByRole('navigation', { name: 'Entraîner' });
    expect(within(tabs).getByRole('link', { name: 'Chatting' })).toBeTruthy();
    expect(within(tabs).getByRole('link', { name: 'Post du canal' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Corrections' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Tests' })).toBeNull();
  });
});
