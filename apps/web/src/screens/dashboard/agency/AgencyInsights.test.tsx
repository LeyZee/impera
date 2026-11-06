// @vitest-environment jsdom
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

import { useFloatingTip } from '../parts';

import { AgencyInsightsPanel } from './AgencyInsights';
import { AGENCY_WEEK, LINA } from './fixture';

const reads: string[] = [];

function serve(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      reads.push(input);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
}

function Panel({ creatorId, canOpenSettings }: { creatorId: string | null; canOpenSettings: boolean }) {
  const tip = useFloatingTip();
  return (
    <AgencyInsightsPanel
      period="week"
      onPeriod={() => undefined}
      creatorId={creatorId}
      creatorName="Lina Test"
      canOpenSettings={canOpenSettings}
      tip={tip}
    />
  );
}

function show(creatorId: string | null = null, canOpenSettings = true): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <div>
        <Panel creatorId={creatorId} canOpenSettings={canOpenSettings} />
      </div>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Reduced motion: the numbers show at once.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })),
  );
});

afterEach(() => {
  cleanup();
  reads.length = 0;
  vi.unstubAllGlobals();
});

describe('L’agence en chiffres (ADR 0078)', () => {
  it('reads the agency’s week from the server and says it in sections, rings and a ranking', async () => {
    serve(200, AGENCY_WEEK);
    show();
    expect(await screen.findByRole('heading', { name: /D’où vient l’argent/u })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /L’agence en chiffres/u })).toBeTruthy();
    expect(reads[0]).toBe('/v1/dashboard/agency?period=week');
    for (const title of [
      'D’où vient l’argent',
      'Qui vend',
      'Qui a vendu',
      'Les créatrices',
      'Quand ça vend',
    ]) {
      expect(screen.getByRole('heading', { name: new RegExp(title, 'u') })).toBeTruthy();
    }
    const ranking = screen.getByRole('list', { name: 'Classement de qui a vendu' });
    expect(within(ranking).getByText('Théo')).toBeTruthy();
    expect(within(ranking).getByText('Agent IA')).toBeTruthy();
    expect(screen.getByText(/Les 10 fans qui dépensent le plus/u).textContent).toContain('58');
    expect(screen.getByText(/21h–0h/u)).toBeTruthy();
  });

  it('reads one creator alone, without the creators side by side', async () => {
    serve(200, {
      ...AGENCY_WEEK,
      creators: [AGENCY_WEEK.creators[0]],
      byCreator: [AGENCY_WEEK.byCreator[0]],
    });
    show(LINA);
    expect(await screen.findByRole('heading', { name: /Qui vend/u })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Les chiffres de Lina Test/u })).toBeTruthy();
    expect(reads[0]).toBe(`/v1/dashboard/agency?period=week&creatorId=${LINA}`);
    expect(screen.queryByRole('heading', { name: /Les créatrices/u })).toBeNull();
  });

  it('says nothing is linked yet, never a made-up figure, and leads the owner to Réglages', async () => {
    serve(200, { ...AGENCY_WEEK, creators: [], byCreator: [], sellers: [], kinds: [] });
    show();
    expect(await screen.findByText(/Aucune créatrice n’est encore reliée/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Réglages › Ventes/u })).toBeTruthy();
    expect(screen.queryByText('Chiffre d’affaires')).toBeNull();
  });

  it('shows nothing to an account whose scope is its own', async () => {
    serve(403, { error: 'creator_forbidden' });
    show(null, false);
    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('heading')).toBeNull();
  });
});
