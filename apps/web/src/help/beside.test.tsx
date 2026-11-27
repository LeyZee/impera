// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter } from '../router';

import { audienceOf, GUIDES_BESIDE, guidesBeside } from './beside';
import { HELP, type HelpAudience } from './guides';

const base: Omit<Me, 'role' | 'team' | 'teamScope'> = {
  id: 'u1',
  email: 'membre@example.test',
  name: 'Théo',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  preferences: { sounds: true },
};
const AUDIENCES: readonly HelpAudience[] = ['owner', 'manager', 'chatter', 'creator'];
const PEOPLE: Readonly<Record<HelpAudience, Me>> = {
  owner: { ...base, role: 'owner', team: null, teamScope: 'owner' },
  manager: { ...base, role: 'operator', team: { role: 'manager', status: 'active' }, teamScope: 'agency' },
  chatter: { ...base, role: 'operator', team: { role: 'chatter', status: 'active' }, teamScope: 'self' },
  creator: {
    ...base,
    role: 'creator',
    creatorIds: ['00000000-0000-4000-8000-000000000001'],
    team: null,
    teamScope: 'self',
  },
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  // The screens stay on their loading state: only the shell and the page's header are under test.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp(user: Me, path: string): void {
  const router = createAppRouter(
    { user, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('the guides beside their screen', () => {
  it('name only screens that exist and guides of the reader’s own book', () => {
    const router = createAppRouter({ user: PEOPLE.owner, onSignOut: () => undefined });
    const paths = new Set(Object.keys(router.routesByPath).map((path) => path.replace(/(.)\/$/u, '$1')));
    for (const [path, byAudience] of Object.entries(GUIDES_BESIDE)) {
      expect(paths.has(path), path).toBe(true);
      for (const audience of AUDIENCES) {
        const ids = byAudience[audience] ?? [];
        for (const id of ids) {
          expect(
            HELP[audience].guides.some((guide) => guide.id === id),
            `${audience} ${id}`,
          ).toBe(true);
        }
      }
    }
  });

  it('give each person the guides of their own book, the address read with or without its last slash', () => {
    expect(guidesBeside('/moi/securite/', 'chatter').map((guide) => guide.id)).toEqual([
      'ton-code-a-deux-facteurs',
    ]);
    expect(guidesBeside('/moi/securite', 'creator')).toEqual([]);
    expect(guidesBeside('/moi/aide', 'chatter')).toEqual([]);
    expect(audienceOf(PEOPLE.manager)).toBe('manager');
  });

  it('fold the screen’s guides under its title, behind one line that names them', async () => {
    renderApp(PEOPLE.chatter, '/planning');
    await screen.findByRole('heading', { level: 1, name: 'Planning' });
    const fold = document.querySelector<HTMLDetailsElement>('.nv-page__head > details.nv-page__guides');
    expect(fold?.open).toBe(false);
    expect(fold?.querySelector('summary')?.textContent).toBe(
      'Pas à pasÉchanger un shift · Demander un congé · Tes shifts dans ton calendrier',
    );
    const guides = [...(fold?.querySelectorAll<HTMLDetailsElement>('details.nv-guide') ?? [])];
    expect(guides.map((guide) => guide.open)).toEqual([false, false, false]);
    expect(guides[0]?.style.getPropertyValue('--_c')).toBe('var(--nv-content-5)');
  });

  it('show nothing on a screen without a guide', async () => {
    renderApp(PEOPLE.chatter, '/moi/preferences');
    await screen.findByRole('heading', { level: 1 });
    expect(document.querySelector('.nv-page__guides')).toBeNull();
  });
});
