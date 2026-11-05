// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyPersonaPage } from './MyPersonaPage';

const CREATOR = '0199f2a0-0000-7000-8000-0000000000c1';

/** An invented creator (ADR 0010): never a real one in a test. */
const SHEET = {
  details: {
    first_name: 'Elena',
    date_of_birth: '2000-04-12',
    ethnicity: 'caucasian',
    timezone: 'Europe/Paris',
    languages: ['french'],
    height_cm: 165,
    weight_kg: null,
    shoe_size_eu: null,
    hair: null,
    eyes: null,
    bra: null,
    hobbies: ['yoga'],
    personality: ['taquine'],
  },
  lifestyle: null,
  tastes: { likes: ['les sushis'], dislikes: [] },
  intimate: null,
  writing_style: null,
  sample_replies: [],
  limits: { never_do: ['anal'], never_show: [], never_say: [], disgusts: ['pieds'] },
};

let sheet: unknown;
const asked: string[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = new URL(input, 'http://localhost');
      asked.push(url.pathname);
      if (url.pathname === '/v1/creators') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              creators: [{ id: CREATOR, displayName: 'Elena', timezone: 'Europe/Paris', nameKey: 'elena' }],
            }),
          ),
        );
      }
      if (url.pathname === `/v1/creators/${CREATOR}/persona/mine`) {
        return Promise.resolve(new Response(JSON.stringify({ creatorId: CREATOR, sheet })));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
}

function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/moi/persona', component: MyPersonaPage });
  const others = ['/moi/securite', '/moi/preferences'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/moi/persona'] }),
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
  asked.length = 0;
  sheet = SHEET;
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Persona (recette CREA-01)', () => {
  it('reads her sheet, in her words, with nothing to change and no word of the agent', async () => {
    renderPage();
    expect(await screen.findByText('Qui tu es')).toBeTruthy();
    expect(screen.getByText('Elena')).toBeTruthy();
    expect(screen.getByText('les sushis')).toBeTruthy();
    expect(screen.getByText('pieds')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/enregistrer|activer/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/agent|IA\b|relance|stratégie|notification/i);
    // Only her door: never the agency's sheet and its history.
    expect(asked).not.toContain(`/v1/creators/${CREATOR}/persona`);
  });

  it('leaves out what is not written, and says it once for a block with nothing', async () => {
    renderPage();
    const life = await screen.findByRole('region', { name: 'Ta vie' });
    expect(life.textContent).toContain('Rien d’écrit pour l’instant.');
    const limits = screen.getByRole('region', { name: 'Tes limites' });
    expect(limits.textContent).toContain('Ce que tu ne fais jamais');
    expect(limits.textContent).not.toContain('Ce que tu ne montres jamais');
    expect(document.body.textContent).not.toMatch(/rien d’écrit$/mu);
    expect(screen.getAllByText('Rien d’écrit pour l’instant.')).toHaveLength(3);
  });

  it('says her sheet is being prepared while she has none', async () => {
    sheet = null;
    renderPage();
    expect(await screen.findByText('Ta fiche est en préparation')).toBeTruthy();
  });
});
