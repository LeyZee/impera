// @vitest-environment jsdom
import { TeamMemberSchema, type Me, type TeamMember } from '@impera/contracts';
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

import { MyProfilePage } from './MyProfilePage';

import { IRIS_ME, LEA_ONLYFANS, NORA_REVEAL, THEO, THEO_ME } from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;

/** Théo, from Porto-Novo, on Nora, at 10 % since the 1st of October. */
const THEO_HERE: TeamMember = TeamMemberSchema.parse({
  ...THEO,
  timeZone: 'Africa/Porto-Novo',
  commission: { rateBps: 1_000, teamShareBps: null, presetId: null, effectiveFrom: '2026-10-01' },
});

function serve(members: readonly TeamMember[], rates: readonly unknown[] = []): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/v1/team/members') return Promise.resolve(Response.json({ members }));
      if (url.pathname.endsWith('/commission')) return Promise.resolve(Response.json({ rates }));
      // The creators of his account, whatever his shifts (recette 16/11, CHT-31): Léa is not on his list.
      if (url.pathname === '/v1/creators')
        return Promise.resolve(
          Response.json({
            creators: [NORA_REVEAL, LEA_ONLYFANS].map(({ creatorId, creatorName }) => ({
              id: creatorId,
              displayName: creatorName,
              timezone: 'Europe/Paris',
            })),
          }),
        );
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
}

function renderPage(user: Me): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/profil',
    component: () => <MyProfilePage user={user} />,
  });
  const others = [
    '/moi/dossier',
    '/moi/factures',
    '/moi/calendrier',
    '/moi/securite',
    '/moi/preferences',
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
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Profil (recette 05/11, CHAT-30)', () => {
  it('says who he is in the team: his creators, his rate and since when, his country and zone', async () => {
    serve([THEO_HERE]);
    renderPage(THEO_ME);
    // The tab is the page's title, his name the card's, which no longer says « Profil » again (recette visuelle 16/11,
    // CHA-12).
    expect(await screen.findByRole('heading', { level: 1, name: 'Profil' })).toBeDefined();
    expect(await screen.findByRole('heading', { level: 2, name: 'Théo' })).toBeDefined();
    expect(screen.queryByRole('heading', { level: 2, name: 'Profil' })).toBeNull();
    const facts = await screen.findByText('Nora Vidal');
    const list = facts.closest('dl');
    if (list === null) throw new Error('No facts');
    const text = list.textContent.replace(NBSP, ' ');
    expect(text).toContain('Chatteur');
    expect(text).not.toContain('Léa');
    expect(text).toContain('10 % · depuis le 1er octobre 2026');
    expect(text).toContain('Bénin');
    expect(text).toContain('Porto-Novo · celui de ton téléphone, repris à chaque ouverture');
    expect(text).toContain('1er septembre 2026');
  });

  it('says the rate set ahead of him, as the owner reads it (PRO2-05)', async () => {
    const inForce = THEO_HERE.commission;
    serve(
      [THEO_HERE],
      [inForce, { rateBps: 2_200, teamShareBps: null, presetId: null, effectiveFrom: '2026-12-01' }],
    );
    renderPage(THEO_ME);
    const facts = await screen.findByText('Nora Vidal');
    await vi.waitFor(() => {
      expect(facts.closest('dl')?.textContent.replace(NBSP, ' ')).toContain(
        '10 % · depuis le 1er octobre 2026 · 22 % à partir du 1er décembre 2026',
      );
    });
  });

  // No « Calendrier »: a chatter's link is on Planning, « Dans mon téléphone » (ADR 0134, lot 1).
  it('opens Moi with Profil, before Dossier', async () => {
    serve([THEO_HERE]);
    renderPage(THEO_ME);
    const tabs = await screen.findByRole('navigation', { name: 'Moi' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Profil', 'Trophées', 'Dossier', 'Sécurité', 'Préférences']);
  });

  it('gives a manager on leave no « Trophées » tab, which his routes would not open (recette 16/11, CHT-05)', async () => {
    serve([THEO_HERE]);
    renderPage({ ...IRIS_ME, team: { role: 'manager', status: 'on_leave' }, teamScope: 'self' });
    const tabs = await screen.findByRole('navigation', { name: 'Moi' });
    expect(
      within(tabs)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Profil', 'Dossier', 'Sécurité', 'Préférences']);
  });
});
