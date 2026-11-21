// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AiUsageSection } from './AiUsageSection';
import { forecastFixture, usageFixture } from './fixture';

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

/** A fake `/v1/settings/ai-usage`: the usage as `read` says, each POST answered by `post` and kept in `posted`. */
function serve(routes: { read?: () => Reply; post?: (body: unknown) => Reply } = {}): unknown[] {
  const posted: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const reply: Reply =
        init?.method === 'POST'
          ? (() => {
              const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
              posted.push(body);
              return routes.post?.(body) ?? { status: 500 };
            })()
          : url === '/v1/settings/ai-usage'
            ? (routes.read?.() ?? { status: 200, body: usageFixture() })
            : { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return posted;
}

function renderPage(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A router: the forecast's cap warning links to Réglages › Modèles IA.
  const rootRoute = createRootRoute();
  const page = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <AiUsageSection now={() => new Date('2026-11-11T13:30:00Z')} />,
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
}

beforeEach(() => {
  // Reduced motion: the numbers show at once.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: () => undefined, removeEventListener: () => undefined })),
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Réglages › Consommation IA (ADR 0091)', () => {
  it('shows today against the cap, the month, the credits and the two rings', async () => {
    serve();
    renderPage();
    const meter = await screen.findByRole('meter', { name: 'Dépense du jour face au plafond' });
    expect(meter.getAttribute('aria-valuetext')).toBe('4,20 € sur 20,00 €');
    expect(screen.getByText(/412 appels, dont 3 en erreur/u)).toBeTruthy();
    // Today, the month and the forecast say what the subscription paid; the cap counts it all the same.
    expect(screen.getByText(/dont 3,60.€ couverts par l’abonnement/u)).toBeTruthy();
    expect(screen.getByText(/dont 9,10.€ couverts par l’abonnement/u)).toBeTruthy();
    expect(screen.getByText(/dont 64,30.€ couverts par l’abonnement/u)).toBeTruthy();
    expect(screen.getByText('Hachuré : couvert par l’abonnement')).toBeTruthy();
    expect(screen.getByText('Prévu fin du mois')).toBeTruthy();
    expect(screen.getByText('Recharger bientôt')).toBeTruthy();
    expect(screen.getByText(/Environ 3 jours au rythme actuel/u)).toBeTruthy();
    expect(screen.getByText('Inclus dans l’abonnement')).toBeTruthy();
    expect(screen.getByText(/Les appels passent sur le quota de ton abonnement/u)).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Par modèle, 30 jours/u })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Par usage, 30 jours : Écrire les messages 54 %/u })).toBeTruthy();
  });

  it('walks the columns with the arrows and switches to today hour by hour', async () => {
    serve();
    renderPage();
    const bars = await screen.findByRole('group', { name: /Dépense jour par jour/u });
    expect(within(bars).getAllByRole('button')).toHaveLength(30);
    fireEvent.click(screen.getByRole('radio', { name: 'Aujourd’hui' }));
    const hours = await screen.findByRole('group', { name: /Dépense heure par heure/u });
    expect(within(hours).getAllByRole('button')).toHaveLength(15);
  });

  it('invites to note a first top-up when the ledger is empty', async () => {
    serve({ read: () => ({ status: 200, body: usageFixture({ credits: [], voice: null }) }) });
    renderPage();
    expect(await screen.findByText(/Aucun crédit noté pour l’instant/u)).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'ElevenLabs' })).toBeNull();
  });

  it('counts ElevenLabs in characters on its own card, and says its free offer (ADR 0091 § 7)', async () => {
    serve({ read: () => ({ status: 200, body: usageFixture({ credits: [] }) }) });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'ElevenLabs' })).toBeTruthy();
    expect(screen.getByRole('meter', { name: 'Caractères du mois encore disponibles' })).toBeTruthy();
    expect(screen.getByText(/Environ 75 vocaux encore, le mois revient le 1er décembre/u)).toBeTruthy();
    expect(screen.getByText(/l’usage commercial n’y est pas autorisé/u)).toBeTruthy();
    expect(
      screen.getByText(/2.480 sur 10.000 caractères utilisés ce mois · lu chez ElevenLabs il y a 9 min/u),
    ).toBeTruthy();
  });

  it('notes a top-up once, in the service’s currency, and says a refusal in words', async () => {
    let attempts = 0;
    const posted = serve({
      post: (body) =>
        attempts++ === 0
          ? { status: 500 }
          : {
              status: 201,
              body: { ...z.record(z.string(), z.unknown()).parse(body), at: '2026-11-11T13:30:00.000Z' },
            },
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour les crédits' }));
    const dialog = screen.getByRole('dialog', { name: 'Mettre à jour les crédits' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(within(dialog).getByText('Un montant comme 25 ou 25,50, sans signe.')).toBeTruthy();
    expect(posted).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('Montant rechargé'), { target: { value: '50' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    expect(await within(dialog).findByText(/Le serveur ne répond pas : rien n’a été noté/u)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(posted).toHaveLength(2);
    const [first, second] = z
      .array(
        z.object({
          id: z.string(),
          provider: z.string(),
          kind: z.string(),
          amountMinor: z.number(),
          currency: z.string(),
        }),
      )
      .parse(posted);
    // The same line twice: one id, so the server writes it once.
    expect(second?.id).toBe(first?.id);
    expect(second).toMatchObject({ provider: 'xai', kind: 'topup', amountMinor: 5000, currency: 'USD' });
  });

  it('notes a service paid by the subscription without an amount (ADR 0091 § 6)', async () => {
    const posted = serve({
      post: (body) => ({
        status: 201,
        body: { ...z.record(z.string(), z.unknown()).parse(body), at: '2026-11-11T13:30:00.000Z' },
      }),
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Mettre à jour les crédits' }));
    const dialog = screen.getByRole('dialog', { name: 'Mettre à jour les crédits' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Payé par l’abonnement' }));
    expect(within(dialog).queryByLabelText('Montant rechargé')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(posted).toEqual([
      expect.objectContaining({ provider: 'xai', kind: 'subscription', amountMinor: 0, currency: 'USD' }),
    ]);
  });

  it('says the server does not answer', async () => {
    serve({ read: () => ({ status: 500 }) });
    renderPage();
    expect(await screen.findByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('forecasts next month with its band, by line of spend and by creator, against the sales (ADR 0091 § 8)', async () => {
    serve();
    renderPage();
    expect(await screen.findByText('Prévu en décembre')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Prévu en décembre : 335.€, de 258.€ à 393.€/u })).toBeTruthy();
    expect(screen.getByText(/En novembre : 291.€ prévus, dont 171.€ déjà dépensés/u)).toBeTruthy();
    expect(screen.getByText(/^476.€$/u)).toBeTruthy();
    expect(screen.getByText(/de 9.300.€ de ventes prévues en décembre/u)).toBeTruthy();
    expect(screen.getByText('Chatting Reveal')).toBeTruthy();
    expect(screen.getByText('Créatrice A')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('warns in amber when the realistic pace goes past the daily cap', async () => {
    serve({
      read: () => ({
        status: 200,
        body: usageFixture({
          forecast: forecastFixture({
            cap: { capEur: 20, reachedAtRealistic: true, reachedWithMoreTraffic: true, nextMonthMaxEur: 620 },
          }),
        }),
      }),
    });
    renderPage();
    const note = await screen.findByRole('note');
    expect(note.textContent).toMatch(/dépasse le plafond de 20,00.€ par jour : il l’arrête chaque jour/u);
    expect(note.textContent).toMatch(/décembre ne dépassera pas 620.€/u);
    expect(within(note).getByRole('link', { name: 'Régler le plafond' })).toBeTruthy();
    expect(screen.getByText('Prévu en décembre, sans plafond')).toBeTruthy();
  });

  it('waits for a first full day before forecasting', async () => {
    serve({ read: () => ({ status: 200, body: usageFixture({ forecast: null }) }) });
    renderPage();
    expect(
      await screen.findByText(/Le prévisionnel apparaît après une première journée complète/u),
    ).toBeTruthy();
  });
});
