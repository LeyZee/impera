// @vitest-environment jsdom
import {
  AgentModeResultSchema,
  CreatorIdSchema,
  REAUTHENTICATION_ERROR_CODE,
  TeamMemberIdSchema,
  type AgentMode,
  type Dashboard as ApiDashboard,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardPage } from './DashboardPage';
import { dashboardSearch, parseDashboardSearch, periodOf } from './logic';

import { apiDashboard, CREATOR, serveDashboard } from '@/test/fakes';

/** The shared mode reaches its readers on the next tick. */
const tick = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

beforeEach(() => {
  // What jsdom lacks and the screen uses only for motion, layout and the router's scroll restoration.
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
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

/** Where the page's router is, once a test has rendered it. */
let location = (): string => '';

function renderDashboard(
  forOwner = false,
  opensTracking = true,
  at = '/',
  canAddCreator = false,
): QueryClient {
  // No delay before the one retry: a failing server shows at once.
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  // The night banner links to Réglages: the page needs a router around it.
  const root = createRootRoute();
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    validateSearch: parseDashboardSearch,
    component: function Home() {
      const search = home.useSearch();
      const navigate = home.useNavigate();
      return (
        <DashboardPage
          period={periodOf(search)}
          onPeriod={(next) => void navigate({ search: dashboardSearch(next), replace: true })}
          forOwner={forOwner}
          opensTracking={opensTracking}
          canAddCreator={canAddCreator}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([
      home,
      createRoute({ getParentRoute: () => root, path: '/reglages/telegram' }),
      createRoute({ getParentRoute: () => root, path: '/reglages/modeles-ia' }),
      createRoute({ getParentRoute: () => root, path: '/suivi' }),
      createRoute({ getParentRoute: () => root, path: '/creatrices' }),
      createRoute({ getParentRoute: () => root, path: '/reglages/sauvegardes' }),
    ]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  location = () => router.state.location.href;
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return client;
}

const headline = (): string => document.querySelector('h1')?.textContent ?? '';
describe('DashboardPage on the server’s data', () => {
  it('waits for the server without showing any figure', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard();
    expect(await screen.findByRole('status', { name: 'Chargement du Dashboard' })).toBeDefined();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('shows what the server says, with no « Exemple » badge and no sales made up', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard();
    expect(await screen.findByText('Kévin')).toBeDefined();
    expect(screen.queryByText('Exemple')).toBeNull();
    expect(headline()).toBe('Une urgence t’attend');
    // No sales block until they are observed, and no « bientôt » line either (recette 05/11, PRO-24).
    expect(screen.queryByText(/bientôt/u)).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Ventes/u })).toBeNull();
    expect(screen.getByText('Théo')).toBeDefined();
    // The best fans' bar names no colour: the agent's part is the data colour, not the urgencies' red.
    expect(screen.getByText(/d’abord la part de l’agent, puis celle des chatteurs/u)).toBeDefined();
    // A todo of the server leaves the list when its conversation is handled, not on a tick here.
    expect(screen.queryByRole('button', { name: 'Marquer comme traité' })).toBeNull();
    // A code comment never reaches the screen as text (relecture d'Extension, CR-02 c2b).
    expect(document.body.textContent).not.toMatch(/\/\/ |PUT \/v1/u);
  });

  it('says under the best fans that the dollars are not counted for want of a rate, or at which one', async () => {
    serveDashboard({ status: 200, body: apiDashboard({ usdSales: { seen: true, rate: null } }) });
    renderDashboard();
    expect(
      await screen.findByText(
        'Les ventes en dollars ne sont pas comptées : aucun taux BCE n’est encore connu.',
      ),
    ).toBeDefined();
    cleanup();
    serveDashboard({
      status: 200,
      body: apiDashboard({ usdSales: { seen: true, rate: { day: '2026-10-27' } } }),
    });
    renderDashboard();
    expect(await screen.findByText('Dollars convertis en euros au taux BCE du 27 octobre.')).toBeDefined();
    cleanup();
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard();
    await screen.findByText('Théo');
    expect(screen.queryByText(/taux BCE/u)).toBeNull();
  });

  it('shows the sales read in Reveal, their figures to the cent and who sold, in place of the quiet line (CRM-04 lot c)', async () => {
    const member = TeamMemberIdSchema.parse('01a1a0ca-3c43-7624-b30f-0000000000aa');
    const figures = {
      sales: 1,
      refunds: 0,
      revenueMinor: 1200,
      netMinor: 800,
      agencyMinor: 300,
      creatorMinor: 500,
    };
    serveDashboard({
      status: 200,
      body: apiDashboard({
        revealSales: {
          platforms: ['reveal'],
          from: '2026-11-03',
          to: '2026-11-03',
          totals: {
            sales: 3,
            refunds: 1,
            revenueMinor: 4234,
            netMinor: 2800,
            agencyMinor: 1050,
            creatorMinor: 1750,
          },
          bySeller: [
            { ...figures, revenueMinor: 3000, seller: { kind: 'agent' } },
            { ...figures, refunds: 1, seller: { kind: 'member', memberId: member, name: 'Maya' } },
            { ...figures, revenueMinor: 34, seller: { kind: 'unlinked' } },
          ],
          usd: { seen: false, rate: null },
          refundsWithoutSale: 1,
          stopped: [],
        },
      }),
    });
    renderDashboard();
    expect(await screen.findByRole('heading', { name: /Ventes lues chez Reveal/u })).toBeDefined();
    expect(screen.getByText('3 ventes · 1 remboursement')).toBeDefined();
    expect(screen.getByText('28 €')).toBeDefined();
    const sellers = screen.getByRole('list', { name: 'Qui a vendu' });
    expect(sellers.textContent).toMatch(/L’agent.*Maya.*Chatteur non relié/u);
    expect(screen.getByText('1 vente · à relier dans Équipe › Reveal')).toBeDefined();
    expect(
      screen.getByText(/1 remboursement porte sur une vente plus ancienne que le registre/u),
    ).toBeDefined();
    expect(screen.queryByText(/Ventes : bientôt lues depuis Reveal/u)).toBeNull();
  });

  it('gives whoever does not see the sellers the figures only (ADR 0043 § 7)', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({
        revealSales: {
          platforms: ['reveal', 'onlyfans'],
          from: '2026-11-03',
          to: '2026-11-03',
          totals: {
            sales: 2,
            refunds: 0,
            revenueMinor: 2400,
            netMinor: 1600,
            agencyMinor: 600,
            creatorMinor: 1000,
          },
          bySeller: null,
          usd: { seen: false, rate: null },
          refundsWithoutSale: 0,
          stopped: [],
        },
      }),
    });
    renderDashboard();
    expect(await screen.findByText('2 ventes')).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Qui a vendu' })).toBeNull();
    // The platforms come from the server, never written in the screen.
    expect(screen.getByRole('heading', { name: /Ventes lues chez Reveal et OnlyFans/u })).toBeDefined();
  });

  it('opens a draft to validate in Suivi, on its conversation', async () => {
    const [draft] = apiDashboard().todos;
    if (draft === undefined) throw new Error('the fixture has a todo');
    serveDashboard({
      status: 200,
      body: apiDashboard({ todos: [{ ...draft, tone: 'warn', kind: 'awaiting_approval' }] }),
    });
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: 'À valider dans Suivi : Kévin' }));
    await waitFor(() => {
      expect(location()).toBe(`/suivi?conversation=${draft.conversationId}`);
    });
  });

  it('opens an urgency in Suivi too, where the conversation is given back to the agent', async () => {
    const [urgent] = apiDashboard().todos;
    if (urgent === undefined) throw new Error('the fixture has a todo');
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard();
    fireEvent.click(await screen.findByRole('button', { name: 'Voir l’urgence' }));
    await waitFor(() => {
      expect(location()).toBe(`/suivi?conversation=${urgent.conversationId}`);
    });
  });

  it('tells a manager who puts the key, and offers no way to Réglages, which he does not have', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({ voice: { ok: false, keyMissing: true, medianWriteMs: null, outagesLast7d: 0 } }),
    });
    renderDashboard();
    await waitFor(() => {
      expect(headline()).toBe('L’IA qui écrit attend sa clé');
    });
    expect(screen.getByText(/^Le propriétaire la pose dans Réglages › Modèles IA\./u)).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Poser la clé' })).toBeNull();
  });

  it('says the voice waits for its key and leads the owner to where it goes', async () => {
    serveDashboard({
      status: 200,
      body: apiDashboard({ voice: { ok: false, keyMissing: true, medianWriteMs: null, outagesLast7d: 0 } }),
    });
    renderDashboard(true);
    await waitFor(() => {
      expect(headline()).toBe('L’IA qui écrit attend sa clé');
    });
    fireEvent.click(screen.getByRole('link', { name: 'Poser la clé' }));
    await waitFor(() => {
      expect(location()).toBe('/reglages/modeles-ia');
    });
  });

  it('says under the hero when nobody is warned at night', async () => {
    serveDashboard({ status: 200, body: apiDashboard({ telegramCoverage: { urgentReachable: false } }) });
    renderDashboard();
    expect(await screen.findByText('Personne n’est prévenu la nuit')).toBeDefined();
  });

  it('offers the group to choose to the owner only, and tells anyone else who does (recette 05/11, PRO-08)', async () => {
    serveDashboard({ status: 200, body: apiDashboard({ telegramCoverage: { urgentReachable: false } }) });
    renderDashboard(false);
    expect(await screen.findByText('Personne n’est prévenu la nuit')).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Choisir un groupe' })).toBeNull();
    expect(screen.getByText('Le propriétaire choisit ce groupe dans Réglages › Telegram.')).toBeDefined();
    cleanup();
    serveDashboard({ status: 200, body: apiDashboard({ telegramCoverage: { urgentReachable: false } }) });
    renderDashboard(true);
    expect(await screen.findByRole('link', { name: 'Choisir un groupe' })).toBeDefined();
  });
});

/** A server that keeps her mode: `PUT /v1/agent/mode` changes what `GET /v1/dashboard` says next. */
function serveModes(
  first: AgentMode,
  answer: (asked: AgentMode) => { status: number; body?: unknown } = (asked) => ({
    status: 200,
    body: { mode: asked, globalStop: false },
  }),
  patch: Partial<ApiDashboard> = {},
): { creatorId: string; mode: AgentMode }[] {
  let state = { mode: first, globalStop: patch.globalStop ?? false };
  const writes: { creatorId: string; mode: AgentMode }[] = [];
  serveDashboard(
    () => ({ status: 200, body: apiDashboard({ ...patch, ...state }) }),
    undefined,
    (body) => {
      writes.push(body);
      const reply = answer(body.mode);
      if (reply.status === 200) state = AgentModeResultSchema.parse(reply.body);
      return reply;
    },
  );
  return writes;
}

const checked = (name: string): string | null =>
  screen.getByRole('radio', { name }).getAttribute('aria-checked');

describe('DashboardPage, its period (recette 28/10, M11 and M12)', () => {
  it('reads the period from the address, so that a reload keeps it, and writes it back there', async () => {
    const fetch = serveDashboard((url) => ({
      status: 200,
      body: apiDashboard({ period: url.searchParams.get('period') === 'week' ? 'week' : 'day' }),
    }));
    renderDashboard(false, true, '/?periode=7j');
    const week = await screen.findByRole('radio', { name: '7 jours' });
    expect(week.getAttribute('aria-checked')).toBe('true');
    const asked = fetch.mock.calls.map(([input]) => String(input)).filter((u) => u.includes('/v1/dashboard'));
    expect(asked.every((u) => u.includes('period=week'))).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: '30 jours' }));
    await waitFor(() => {
      expect(location()).toBe('/?periode=30j');
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Aujourd’hui' }));
    await waitFor(() => {
      expect(location()).toBe('/');
    });
  });

  it('moves between the periods with the arrow keys, one stop of the Tab key for the group', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard();
    const today = await screen.findByRole('radio', { name: 'Aujourd’hui' });
    const week = screen.getByRole('radio', { name: '7 jours' });
    expect(today.tabIndex).toBe(0);
    expect(week.tabIndex).toBe(-1);
    today.focus();
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(location()).toBe('/?periode=7j');
    });
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: '7 jours' }));
    fireEvent.keyDown(document.activeElement ?? week, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(location()).toBe('/');
    });
    // As Réglages › Apparence: past the first, the last.
    fireEvent.keyDown(document.activeElement ?? today, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(location()).toBe('/?periode=30j');
    });
  });
});

describe('DashboardPage changing the mode', () => {
  it('stops the agent after the confirmation, on the server, and resumes it in one click', async () => {
    const writes = serveModes('copilot');
    renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Arrêt' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’agent' }));
      await tick();
    });
    await waitFor(() => {
      expect(checked('Arrêt')).toBe('true');
    });
    expect(headline()).toContain('arrêté');
    expect(writes).toEqual([{ creatorId: CREATOR.id, mode: 'stop' }]);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Repasser en copilote' }));
      await tick();
    });
    await waitFor(() => {
      expect(checked('Copilote')).toBe('true');
    });
  });

  it('drops a read still in flight, so an Arrêt is never put back by an older answer', async () => {
    let mode: AgentMode = 'copilot';
    let reads = 0;
    const held: (() => void)[] = [];
    const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) => {
        const path = new URL(input, 'http://localhost').pathname;
        if (path === '/v1/creators') return Promise.resolve(json({ creators: [CREATOR] }));
        if (init?.method === 'PUT') {
          mode = 'stop';
          return Promise.resolve(json({ mode, globalStop: false }));
        }
        reads += 1;
        const answer = json(apiDashboard({ mode }));
        // The second read, sent before the click, answers the old mode only once the click is done.
        if (reads !== 2) return Promise.resolve(answer);
        return new Promise<Response>((resolve) => {
          held.push(() => {
            resolve(answer);
          });
        });
      }),
    );
    const client = renderDashboard();
    await screen.findByRole('radio', { name: 'Arrêt' });
    void client.refetchQueries({ queryKey: ['dashboard'] });
    await waitFor(() => {
      expect(held).toHaveLength(1);
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Arrêt' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’agent' }));
      await tick();
    });
    await act(async () => {
      held.forEach((release) => {
        release();
      });
      await tick();
    });
    expect(checked('Arrêt')).toBe('true');
  });

  it('keeps the grave lines on Arrêt and only them (choix de Charles, 28/10)', async () => {
    const [grave] = apiDashboard().todos;
    if (grave === undefined) throw new Error('the fixture has a todo');
    // A line the server no longer sends on Arrêt, still held from the read before the stop.
    serveModes('stop', undefined, {
      todos: [grave, { ...grave, id: 'todo-2', tone: 'warn', kind: 'awaiting_approval', title: 'Marc' }],
    });
    renderDashboard();
    expect(await screen.findByRole('button', { name: 'Mineur possible : Kévin' })).toBeDefined();
    expect(screen.queryByText('Marc')).toBeNull();
    expect(headline()).toContain('arrêté');
    expect(screen.getByText(/Une urgence reste à traiter quand même/u)).toBeDefined();
  });

  it('says nothing waits on Arrêt when no grave line does', async () => {
    serveModes('stop', undefined, { todos: [] });
    renderDashboard();
    await screen.findByRole('radio', { name: 'Arrêt' });
    expect(screen.queryByText('Rien à traiter pour l’instant.')).toBeNull();
    expect(screen.getByText(/Les chatteurs gardent la main dans Reveal/u)).toBeDefined();
  });

  it('says so when the global switch keeps the agent stopped', async () => {
    serveModes('stop', () => ({ status: 200, body: { mode: 'stop', globalStop: true } }));
    renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Copilote' }));
    expect((await screen.findByRole('alert')).textContent).toContain('arrêt général');
    expect(checked('Arrêt')).toBe('true');
  });

  it('says from the start when a global switch holds the agent, and offers no way back it cannot give', async () => {
    serveModes('stop', undefined, { globalStop: true });
    renderDashboard();
    // In the hero, next to the sentence it explains, not in a corner (DASH-08).
    expect(await screen.findByText(/Un arrêt général est posé pour toutes les créatrices/u)).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('radio', { name: 'Copilote' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Repasser en copilote' })).toBeNull();
  });

  it('says it is sending while the server has not answered', async () => {
    serveModes('stop');
    const server = globalThis.fetch;
    let answer: (() => void) | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string, init?: RequestInit) =>
        init?.method === 'PUT'
          ? new Promise<Response>((resolve) => {
              answer = () => {
                resolve(
                  new Response(JSON.stringify({ mode: 'copilot', globalStop: false }), { status: 200 }),
                );
              };
            })
          : server(input, init),
      ),
    );
    renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Copilote' }));
    expect(await screen.findByText('Envoi au serveur…')).toBeDefined();
    expect(checked('Arrêt')).toBe('true');
    await act(async () => {
      answer?.();
      await tick();
    });
    await waitFor(() => {
      expect(screen.queryByText('Envoi au serveur…')).toBeNull();
    });
  });

  it('drops a refusal once the page has read the server again', async () => {
    serveModes('copilot', () => ({ status: 500 }));
    const client = renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Arrêt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’agent' }));
    expect(await screen.findByRole('alert')).toBeDefined();
    await act(async () => {
      await client.refetchQueries({ queryKey: ['dashboard'] });
      await tick();
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows the server’s refusal of Automatique and changes nothing', async () => {
    serveModes(
      'copilot',
      () => ({
        status: 409,
        body: {
          error: {
            code: 'agent_mode_conflict',
            message: 'Le mode Automatique reste fermé',
            details: {
              missing: [{ kind: 'live_rate', value: 79.5, target: 80 }, { kind: 'blind_test' }],
            },
            requestId: 'req-1',
          },
        },
      }),
      { automatic: { open: true, missing: [] } },
    );
    renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Automatique' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Automatique reste fermé : taux en réel 79,5\u00a0% sur 80\u00a0%, test à l’aveugle pas encore validé.',
    );
    expect(checked('Copilote')).toBe('true');
  });

  it('asks the password and the code again before Automatique, then sends it once more (reco 9)', async () => {
    let mode: AgentMode = 'copilot';
    let confirmed = false;
    const writes: AgentMode[] = [];
    const fetch = serveDashboard(
      (url) => {
        if (url.pathname !== '/v1/auth/reauthenticate')
          return { status: 200, body: apiDashboard({ mode, automatic: { open: true, missing: [] } }) };
        confirmed = true;
        return { status: 200, body: {} };
      },
      undefined,
      (body) => {
        writes.push(body.mode);
        if (body.mode === 'auto' && !confirmed)
          return {
            status: 403,
            body: {
              error: {
                code: REAUTHENTICATION_ERROR_CODE,
                message: 'Mot de passe et code à confirmer',
                details: {},
                requestId: 'req-2',
              },
            },
          };
        mode = body.mode;
        return { status: 200, body: { mode, globalStop: false } };
      },
    );
    renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Automatique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Passer en Automatique' });
    expect(within(dialog).getByText(/confirme ton mot de passe et ton code/u)).toBeDefined();
    // The refusal is a question, not an error: nothing is said in the corner, and the mode has not moved.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(checked('Copilote')).toBe('true');

    fireEvent.change(within(dialog).getByLabelText('Mot de passe'), { target: { value: 'secret-de-test' } });
    fireEvent.change(within(dialog).getByLabelText('Code à 6 chiffres ou de secours'), {
      target: { value: '123456' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
      await tick();
    });
    await waitFor(() => {
      expect(checked('Automatique')).toBe('true');
    });
    expect(writes).toEqual(['auto', 'auto']);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetch.mock.calls.some(([input]) => String(input) === '/v1/auth/reauthenticate')).toBe(true);
  });

  it('leaves the mode as it was when the password is not given', async () => {
    const writes = serveModes(
      'copilot',
      () => ({
        status: 403,
        body: {
          error: { code: REAUTHENTICATION_ERROR_CODE, message: 'Confirme', details: {}, requestId: 'req-3' },
        },
      }),
      { automatic: { open: true, missing: [] } },
    );
    renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Automatique' }));
    const dialog = await screen.findByRole('dialog', { name: 'Passer en Automatique' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(checked('Copilote')).toBe('true');
    expect(writes).toEqual([{ creatorId: CREATOR.id, mode: 'auto' }]);
  });

  it('never shows a change the server did not make', async () => {
    serveModes('copilot', () => ({ status: 500 }));
    renderDashboard();
    fireEvent.click(await screen.findByRole('radio', { name: 'Arrêt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’agent' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Le mode n’a pas changé');
    expect(checked('Copilote')).toBe('true');
    expect(headline()).not.toContain('arrêté');
  });
});

describe('DashboardPage of the owner', () => {
  const backups = (state: 'ok' | 'overdue' | 'never') => (url: URL) =>
    url.pathname === '/v1/backups/status'
      ? {
          status: 200,
          body: {
            state,
            lastSucceededAt: state === 'never' ? null : '2026-10-26T02:12:00.000Z',
            overdueAfterHours: 26,
            lastRun: null,
            lastRestoreTest: {
              testedAt: '2026-10-01T10:00:00.000Z',
              backupFinishedAt: '2026-09-30T01:05:00.000Z',
              durationSeconds: 420,
              rowCountMismatches: 0,
            },
            restoreTestFresh: true,
          },
        }
      : { status: 200, body: apiDashboard() };

  it('says in amber when no export succeeded for too long', async () => {
    serveDashboard(backups('overdue'));
    renderDashboard(true);
    expect(await screen.findByText(/^Aucune sauvegarde réussie depuis le 26 octobre/u)).toBeDefined();
    // Where the export is read and a restore test noted, one click away (DASH-19).
    expect(screen.getByRole('link', { name: 'Voir les sauvegardes' }).getAttribute('href')).toBe(
      '/reglages/sauvegardes',
    );
  });

  it('says when none was ever made, and nothing while they are on time', async () => {
    serveDashboard(backups('never'));
    renderDashboard(true);
    expect(await screen.findByText('Aucune sauvegarde encore')).toBeDefined();
    cleanup();
    serveDashboard(backups('ok'));
    renderDashboard(true);
    await screen.findByRole('radio', { name: 'Arrêt' });
    expect(screen.queryByText(/Aucune sauvegarde/u)).toBeNull();
  });

  it('says when no restore test is recent, with the exports on time', async () => {
    serveDashboard((url: URL) =>
      url.pathname === '/v1/backups/status'
        ? {
            status: 200,
            body: {
              state: 'ok',
              lastSucceededAt: '2026-10-26T02:12:00.000Z',
              overdueAfterHours: 26,
              lastRun: null,
              lastRestoreTest: null,
              restoreTestFresh: false,
            },
          }
        : { status: 200, body: apiDashboard() },
    );
    renderDashboard(true);
    expect(await screen.findByText('Aucun essai de restauration récent')).toBeDefined();
  });

  it('is the owner’s alone: nobody else reads the exports', async () => {
    const fetched = serveDashboard(backups('never'));
    renderDashboard();
    await screen.findByRole('radio', { name: 'Arrêt' });
    expect(screen.queryByText('Aucune sauvegarde encore')).toBeNull();
    expect(fetched.mock.calls.map(([input]) => String(input))).not.toContain('/v1/backups/status');
  });
});

describe('DashboardPage when the server does not answer', () => {
  it('says so in one sentence, with no figure and only « Réessayer » (DASH-22)', async () => {
    let up = false;
    serveDashboard(() => (up ? { status: 200, body: apiDashboard() } : { status: 500 }));
    renderDashboard();
    expect(await screen.findByText('ne répond pas')).toBeDefined();
    expect(headline()).toBe('Le serveur ne répond pas');
    expect(screen.getByText('Léa')).toBeDefined();
    expect(screen.queryByText('Exemple')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['Réessayer']);
    up = true;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Kévin')).toBeDefined();
  });

  it('never keeps an older answer on screen once a read fails', async () => {
    let up = true;
    serveDashboard(() => (up ? { status: 200, body: apiDashboard() } : { status: 500 }));
    const client = renderDashboard();
    expect(await screen.findByText('Kévin')).toBeDefined();
    up = false;
    await act(async () => {
      await client.refetchQueries({ queryKey: ['dashboard'] });
      await tick();
    });
    expect(headline()).toBe('Le serveur ne répond pas');
    expect(screen.queryByText('Kévin')).toBeNull();
  });
});

describe('DashboardPage before any creator exists', () => {
  it('asks for a first creator, with no made-up figure (DASH-13)', async () => {
    serveDashboard({ status: 200, body: apiDashboard() }, []);
    renderDashboard(true, true, '/', true);
    await waitFor(() => {
      expect(headline()).toBe('Ajoute ta première créatrice');
    });
    expect(screen.getByRole('link', { name: 'Aller à Créatrices' }).getAttribute('href')).toBe('/creatrices');
    expect(screen.queryByText('Kévin')).toBeNull();
    expect(screen.queryByText('Exemple')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('tells an account that cannot add one who does', async () => {
    serveDashboard({ status: 200, body: apiDashboard() }, []);
    renderDashboard();
    await waitFor(() => {
      expect(headline()).toBe('Aucune créatrice pour l’instant');
    });
    expect(screen.getByText(/Le propriétaire de l’agence les ajoute/u)).toBeDefined();
    expect(screen.queryByRole('link')).toBeNull();
  });
});

describe('DashboardPage with several creators (recette 28/10, G1)', () => {
  // Before Léa in the alphabet: the server lists her first.
  const ANA = { id: '0192f3a0-0000-7000-8000-0000000000c2', displayName: 'Ana', timezone: 'Europe/Paris' };
  const writes: { creatorId: string; mode: AgentMode }[] = [];

  /** Whose Dashboard was read last. */
  let lastRead = (): string | null => null;

  /** Each creator's own Dashboard, by the id asked for. */
  function serveBoth(): void {
    writes.length = 0;
    const server = serveDashboard(
      (url) => {
        const ana = url.searchParams.get('creatorId') === ANA.id;
        return {
          status: 200,
          body: apiDashboard({
            creator: {
              id: CreatorIdSchema.parse(ana ? ANA.id : CREATOR.id),
              name: ana ? 'Ana' : 'Léa',
              timezone: 'Europe/Paris',
              now: '2026-10-19T12:00:00Z',
            },
          }),
        };
      },
      [ANA, CREATOR],
      (body) => {
        writes.push(body);
        return { status: 200, body: { mode: body.mode, globalStop: false } };
      },
    );
    lastRead = () => {
      const reads = server.mock.calls
        .map(([input]) => new URL(String(input), 'http://localhost'))
        .filter((url) => url.pathname === '/v1/dashboard');
      return reads.at(-1)?.searchParams.get('creatorId') ?? null;
    };
  }

  afterEach(() => {
    localStorage.clear();
  });

  it('shows the first creator until another is chosen, then hers, and stops the one on screen', async () => {
    serveBoth();
    renderDashboard();
    expect((await screen.findByRole('radio', { name: 'Ana' })).getAttribute('aria-checked')).toBe('true');
    // The chips name her: the header does not say it a second time (DASH-03).
    await waitFor(() => {
      expect(lastRead()).toBe(ANA.id);
    });
    expect(document.querySelector('.db-top__name')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Léa' }));
    await waitFor(() => {
      expect(lastRead()).toBe(CREATOR.id);
    });
    expect((await screen.findByRole('radio', { name: 'Léa' })).getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByRole('radio', { name: 'Arrêt' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’agent' }));
      await tick();
    });
    expect(writes).toEqual([{ creatorId: CREATOR.id, mode: 'stop' }]);
  });

  it('keeps the choice over a reload, and moves it with the arrow keys', async () => {
    serveBoth();
    localStorage.setItem('impera.followed-creator', CREATOR.id);
    renderDashboard();
    const lea = await screen.findByRole('radio', { name: 'Léa' });
    expect(lea.getAttribute('aria-checked')).toBe('true');
    expect(lea.tabIndex).toBe(0);
    fireEvent.keyDown(lea, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(lastRead()).toBe(ANA.id);
    });
    expect(localStorage.getItem('impera.followed-creator')).toBe(ANA.id);
  });

  it('shows the urgencies of the others on their chip, and says when they cannot be read (DASH-03)', async () => {
    let queue = true;
    serveDashboard(
      (url) =>
        url.pathname === '/v1/dashboard/todos'
          ? queue
            ? {
                status: 200,
                body: {
                  items: [],
                  creators: [
                    { creatorId: ANA.id, name: 'Ana', todos: 1, grave: 1 },
                    { creatorId: CREATOR.id, name: 'Léa', todos: 3, grave: 2 },
                  ],
                },
              }
            : { status: 500 }
          : { status: 200, body: apiDashboard() },
      [ANA, CREATOR],
    );
    renderDashboard();
    // Ana is followed: her own urgencies are on the page; Léa's are on her chip.
    expect(await screen.findByRole('radio', { name: 'Léa, 2 urgences' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Ana' })).toBeDefined();
    // The live region is there before it has anything to say, so that its text is announced when it comes.
    const quiet = document.querySelector('.db-creators__unread');
    expect(quiet?.getAttribute('role')).toBe('status');
    expect(quiet?.textContent).toBe('');
    cleanup();
    queue = false;
    renderDashboard();
    expect(
      await screen.findByText(/Les urgences des autres créatrices n’ont pas pu être lues/u, undefined, {
        timeout: 4000,
      }),
    ).toBeDefined();
  });

  it('offers no choice with a single creator', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard();
    expect(await screen.findByText('Kévin')).toBeDefined();
    expect(screen.queryByRole('radiogroup', { name: 'Créatrice suivie' })).toBeNull();
  });
});

describe('DashboardPage, the fold of the agent', () => {
  it('says each card’s detail to a screen reader, not only in the tip (DASH-17)', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard(true);
    await screen.findByText('Kévin');
    const rate = [...document.querySelectorAll('.nv-tile')].find((tile) =>
      tile.textContent.includes('Taux en réel'),
    );
    expect(rate?.querySelector('.sr-only')?.textContent).toContain('Automatique : à partir de');
  });

  it('says whose hour the header gives: hers (ADM-27)', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard(true);
    await screen.findByText('Kévin');
    expect(document.querySelector('.db-top__when')?.textContent).toMatch(/^Chez elle : /u);
  });

  it('offers the owner the guide to link Reveal while it is not linked (ADM-18)', async () => {
    const body = apiDashboard();
    serveDashboard({
      status: 200,
      body: { ...body, reveal: { ...body.reveal, connected: false, lastReadAt: null, conversations: 0 } },
    });
    renderDashboard(true);
    expect((await screen.findByRole('link', { name: 'Comment relier Reveal' })).getAttribute('href')).toBe(
      '/aide/reveal',
    );
  });

  it('says the AI budget once, for the whole agency, apart from her agent’s health (recette 05/11, reco 18)', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard(true);
    await screen.findByText('Kévin');
    const tiles = [...document.querySelectorAll('.nv-tile')].map((tile) => tile.textContent);
    expect(tiles.some((text) => text.includes('Budget IA'))).toBe(false);
    const agency = screen.getByRole('complementary', { name: 'Pour toute l’agence' });
    expect(agency.textContent).toContain('Budget IA du jour, toutes créatrices');
  });
});

describe('DashboardPage, its best fans', () => {
  it('opens his conversation in Suivi, with no reader in between (DASH-14)', async () => {
    const [theo] = apiDashboard().fans;
    if (theo === undefined) throw new Error('the fixture has a fan');
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard();
    fireEvent.click(await screen.findByText('Théo'));
    expect(screen.queryByRole('dialog', { name: 'Conversation' })).toBeNull();
    await waitFor(() => {
      expect(location()).toBe(`/suivi?conversation=${theo.conversationId}&creatrice=${CREATOR.id}`);
    });
  });

  it('is read only for an account whose rail has no Suivi', async () => {
    serveDashboard({ status: 200, body: apiDashboard() });
    renderDashboard(false, false);
    const theo = await screen.findByText('Théo');
    expect(theo.closest('button')).toBeNull();
    fireEvent.click(theo);
    expect(location()).toBe('/');
  });
});
