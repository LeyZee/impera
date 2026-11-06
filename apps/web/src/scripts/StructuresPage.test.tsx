// @vitest-environment jsdom
import { SCRIPT_STARTERS } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StructuresPage } from './StructuresPage';
import { stackSummary } from './model';

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      const body =
        url === '/v1/script-structures/starters'
          ? { starters: SCRIPT_STARTERS }
          : url === '/v1/script-structures'
            ? { structures: [] }
            : { creators: [] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    }),
  );
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: StructuresPage });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Structures, the library', () => {
  it('counts what a tile has to shoot as the workshop does, bridges included (recette 05/11, PRO-05)', async () => {
    serve();
    renderPage();
    const starter = SCRIPT_STARTERS[0];
    if (starter === undefined) throw new Error('no starter');
    const summary = stackSummary(starter.body.segments);
    expect(summary).toMatch(/ponts? ·/u);
    expect(await screen.findByText(new RegExp(`· ${summary}$`, 'u'))).toBeDefined();
  });
});
