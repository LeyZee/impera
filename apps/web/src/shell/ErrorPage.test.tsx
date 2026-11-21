// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorPage } from './ErrorPage';

import { forgetSentReports } from '@/lib/error-reports';
import type { RouterContext } from '@/router';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  forgetSentReports();
});

describe('ErrorPage (recette 16/11, CHT-06)', () => {
  it('says in French that the screen could not draw itself, and leads back to the first tab', async () => {
    // React reports the thrown error on the console: expected here.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sent: string[] = [];
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => {
      sent.push(`${input} ${typeof init?.body === 'string' ? init.body : ''}`);
      return Promise.resolve(new Response(null, { status: 204 }));
    });
    const root = createRootRouteWithContext<RouterContext>()({ component: () => <Outlet /> });
    const broken = createRoute({
      getParentRoute: () => root,
      path: '/planning',
      component: function Broken(): never {
        throw new RangeError('Invalid time value');
      },
    });
    const user: Me = {
      id: 'u1',
      email: 'membre@example.test',
      name: 'Nora',
      creatorIds: [],
      routedCreatorIds: [],
      shiftCreatorIds: [],
      preferences: { sounds: true },
      role: 'operator',
      team: { role: 'chatter', status: 'active' },
      teamScope: 'self',
    };
    const router = createRouter({
      routeTree: root.addChildren([broken]),
      context: { user, onSignOut: () => undefined },
      history: createMemoryHistory({ initialEntries: ['/planning'] }),
      defaultErrorComponent: ErrorPage,
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Cette page n’a pas pu s’afficher' })).toBeDefined();
    expect(screen.queryByText(/Something went wrong/u)).toBeNull();
    expect(screen.getByRole('link', { name: 'Revenir à Aujourd’hui' }).getAttribute('href')).toBe(
      '/aujourdhui',
    );
    // The error is told to the API once (OPS-18), with the route's template.
    expect(sent).toEqual([expect.stringContaining('/v1/client-errors')]);
    expect(sent[0]).toContain('"message":"RangeError: Invalid time value"');
    expect(sent[0]).toContain('"route":"/planning"');
  });
});
