// @vitest-environment jsdom
import {
  REAUTHENTICATION_ERROR_CODE,
  SalesFeedImportCandidateSchema,
  type SalesFeedDismissedModel,
  type SalesFeedImportCandidate,
  type SalesFeedOverview,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { ImportPanel } from './ImportPanel';

const ZOE = '00000000-0000-4000-8000-0000000000c2';
const NEW_NORA = '00000000-0000-4000-8000-0000000000c9';
const BASE = '/v1/settings/sales-feeds/reveal';

const NORA: SalesFeedImportCandidate = SalesFeedImportCandidateSchema.parse({
  model: {
    platformModelId: 'm1',
    handle: 'nora.fake',
    displayName: 'Nora Test',
    isActive: true,
    status: 'validated',
    avatarUrl: null,
  },
  proposal: { kind: 'create' },
  preselected: true,
});
const ZOE_MODEL: SalesFeedImportCandidate = SalesFeedImportCandidateSchema.parse({
  model: {
    platformModelId: 'm2',
    handle: 'zoe',
    displayName: 'Zoé',
    isActive: true,
    status: 'validated',
    avatarUrl: null,
  },
  proposal: { kind: 'link', creatorId: ZOE, creatorDisplayName: 'Zoé', match: 'handle' },
  preselected: true,
});
const PENDING: SalesFeedImportCandidate = SalesFeedImportCandidateSchema.parse({
  model: {
    platformModelId: 'm3',
    handle: 'iris',
    displayName: 'Iris',
    isActive: true,
    status: 'pending',
    avatarUrl: null,
  },
  proposal: { kind: 'create' },
  preselected: false,
});
const DISMISSED: SalesFeedDismissedModel = {
  model: {
    platformModelId: 'm4',
    handle: 'old',
    displayName: 'Ancienne',
    isActive: false,
    status: 'banned',
    avatarUrl: null,
  },
  dismissedAt: '2026-11-04T10:00:00.000Z',
};

/** The overview after a call: only what the panel reads matters here. */
const overviewAfter = (patch: Partial<SalesFeedOverview>): SalesFeedOverview => ({
  status: {
    platform: 'reveal',
    state: 'connected',
    capabilities: ['sales'],
    verifiedAt: null,
    lastReadAt: null,
    lastErrorKind: null,
    message: 'Les ventes remontent.',
    quarantined: 0,
    webhook: null,
  },
  models: [],
  accounts: [],
  chatters: [],
  listError: null,
  candidates: [],
  dismissed: [],
  ...patch,
});

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown };

function serve(
  routes: Record<string, Handler>,
): Mock<(url: string, init?: RequestInit) => Promise<Response>> {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${url}`];
    const { status, body } = handler === undefined ? { status: 404, body: null } : handler(init);
    return Promise.resolve(Response.json(body, { status }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const CREATORS: Handler = () => ({
  status: 200,
  body: { creators: [{ id: ZOE, displayName: 'Zoé', timezone: 'Europe/Paris' }] },
});

function show(
  candidates: readonly SalesFeedImportCandidate[],
  dismissed: readonly SalesFeedDismissedModel[] = [],
): Mock<(overview: SalesFeedOverview) => void> {
  const onChanged = vi.fn<(overview: SalesFeedOverview) => void>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <ImportPanel platform="reveal" candidates={candidates} dismissed={dismissed} onChanged={onChanged} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return onChanged;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« N créatrices trouvées sur Reveal » (CRM-07)', () => {
  it('ticks the validated ones in advance, with what the server proposes', async () => {
    serve({ 'GET /v1/creators': CREATORS });
    show([NORA, ZOE_MODEL, PENDING]);
    expect(await screen.findByRole('heading', { name: '3 créatrices trouvées sur Reveal' })).toBeDefined();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Importer Nora Test (@nora.fake)' }).checked,
    ).toBe(true);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Importer Iris (@iris)' }).checked).toBe(
      false,
    );
    expect(screen.getByText('En attente chez Reveal')).toBeDefined();
    const zoe = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Que faire de Zoé (@zoe)' });
    expect(zoe.value).toBe(`link:${ZOE}`);
    expect(screen.getByText('Même pseudo qu’un compte de Zoé')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Importer la sélection (2)' })).toBeDefined();
    // Her photo stays at the platform: no image is loaded from elsewhere.
    expect(document.querySelector('img')).toBeNull();
  });

  it('sends only the identifiers and the choices, then says what was done', async () => {
    const fetch = serve({
      'GET /v1/creators': CREATORS,
      [`POST ${BASE}/import`]: () => ({
        status: 200,
        body: {
          lines: [
            { platformModelId: 'm1', outcome: 'created', creatorId: NEW_NORA },
            { platformModelId: 'm3', outcome: 'refused', reason: 'name_taken' },
          ],
          overview: overviewAfter({}),
        },
      }),
    });
    const onChanged = show([NORA, ZOE_MODEL, PENDING]);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Importer Zoé (@zoe)' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Importer Iris (@iris)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Importer la sélection (2)' }));

    const done = await screen.findByRole('status');
    expect(within(done).getByText('1 créée, 1 refusée.')).toBeDefined();
    expect(within(done).getByText(/porte déjà ce nom/u)).toBeDefined();
    expect(within(done).getByRole('link', { name: 'Voir sa fiche' }).getAttribute('href')).toContain(
      NEW_NORA,
    );
    expect(within(done).getByText(/il reste son pourcentage, son fuseau/u)).toBeDefined();
    expect(onChanged).toHaveBeenCalledTimes(1);

    const sent = fetch.mock.calls.find(([url]) => url === `${BASE}/import`)?.[1]?.body;
    expect(typeof sent).toBe('string');
    expect(JSON.parse(typeof sent === 'string' ? sent : '')).toEqual({
      lines: [
        { platformModelId: 'm1', action: { kind: 'create' } },
        { platformModelId: 'm3', action: { kind: 'create' } },
      ],
    });
  });

  it('sends more than 100 lines in turns, and keeps what the first turn did when the next fails', async () => {
    const many = Array.from({ length: 101 }, (_, index) =>
      SalesFeedImportCandidateSchema.parse({
        model: {
          platformModelId: `b${String(index)}`,
          handle: `fake${String(index)}`,
          displayName: `Fausse ${String(index)}`,
          isActive: true,
          status: 'validated',
          avatarUrl: null,
        },
        proposal: { kind: 'create' },
        preselected: true,
      }),
    );
    let calls = 0;
    const fetch = serve({
      'GET /v1/creators': CREATORS,
      [`POST ${BASE}/import`]: (init) => {
        calls += 1;
        if (calls > 1) {
          return {
            status: 500,
            body: { error: { code: 'internal', message: 'Oups.', details: {}, requestId: 'r' } },
          };
        }
        const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : '{}');
        const sentLines =
          typeof body === 'object' && body !== null && 'lines' in body && Array.isArray(body.lines)
            ? body.lines.length
            : 0;
        expect(sentLines).toBe(100);
        return {
          status: 200,
          body: {
            lines: many.slice(0, 100).map((c) => ({
              platformModelId: c.model.platformModelId,
              outcome: 'created',
              creatorId: NEW_NORA,
            })),
            overview: overviewAfter({}),
          },
        };
      },
    });
    const onChanged = show(many);
    fireEvent.click(await screen.findByRole('button', { name: 'Importer la sélection (101)' }));
    expect(await screen.findByText('100 créées.')).toBeDefined();
    expect(await screen.findByText(/Le reste n’a pas été importé/u)).toBeDefined();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.filter(([url]) => url === `${BASE}/import`)).toHaveLength(2);
  });

  it('asks for her password again when the sign-in is too old, and keeps the selection', async () => {
    serve({
      'GET /v1/creators': CREATORS,
      [`POST ${BASE}/import`]: () => ({
        status: 403,
        body: {
          error: { code: REAUTHENTICATION_ERROR_CODE, message: 'Confirme.', details: {}, requestId: 'r' },
        },
      }),
    });
    show([NORA]);
    fireEvent.click(await screen.findByRole('button', { name: 'Importer la sélection (1)' }));
    expect(await screen.findByText(/Pour ajouter des créatrices, confirme ton mot de passe/u)).toBeDefined();
    expect(
      screen.getByRole<HTMLInputElement>('checkbox', { name: 'Importer Nora Test (@nora.fake)' }).checked,
    ).toBe(true);
  });

  it('dismisses a line and takes a dismissed one back', async () => {
    const fetch = serve({
      'GET /v1/creators': CREATORS,
      [`PUT ${BASE}/models/m3/dismissal`]: () => ({ status: 200, body: overviewAfter({}) }),
      [`DELETE ${BASE}/models/m4/dismissal`]: () => ({ status: 200, body: overviewAfter({}) }),
    });
    const onChanged = show([PENDING], [DISMISSED]);
    fireEvent.click(await screen.findByRole('button', { name: 'Écarter Iris (@iris)' }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Écartées')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Reprendre Ancienne (@old)' }));
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(2);
    });
    expect(
      fetch.mock.calls.some(
        ([url, init]) => url === `${BASE}/models/m4/dismissal` && init?.method === 'DELETE',
      ),
    ).toBe(true);
  });

  it('shows nothing when there is no one to import and nothing dismissed', () => {
    const fetch = serve({});
    show([]);
    expect(screen.queryByRole('heading')).toBeNull();
    // No list to choose from, so her creators are not read either.
    expect(fetch).not.toHaveBeenCalled();
  });
});
