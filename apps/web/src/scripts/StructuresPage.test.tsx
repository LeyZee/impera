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
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StructuresPage, StructuresView } from './StructuresPage';
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

function Library(): JSX.Element {
  return <StructuresPage queues={false} onQueues={() => undefined} />;
}

function renderPage(component: () => JSX.Element = Library): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component });
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

  it('is a view of a creator’s sheet without a page of its own, « Nouvelle structure » beside its views (ADR 0149 § 1)', async () => {
    serve();
    renderPage(StructuresView);
    const views = await screen.findByRole('radiogroup', { name: 'Vue des structures' });
    expect(views.parentElement?.querySelector('button.nv-btn')?.textContent).toBe('Nouvelle structure');
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByRole('link', { name: '← Créatrices' })).toBeNull();
  });

  it('shows the view the address names and hands a change back to it (recette COUV-09)', async () => {
    serve();
    const onQueues = vi.fn();
    renderPage(() => <StructuresPage queues onQueues={onQueues} />);
    const queues = await screen.findByRole('radio', { name: 'Files des créatrices' });
    expect(queues.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Bibliothèque' }));
    expect(onQueues).toHaveBeenCalledWith(false);
  });
});
