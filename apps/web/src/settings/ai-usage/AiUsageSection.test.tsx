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
    expect(meter.getAttribute('aria-valuetext')).toBe('4,20 € sur 25,00 €');
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

  it('forecasts next month with its verdict, its curve, by line of spend and by creator (ADR 0091 § 8)', async () => {
    serve();
    renderPage();
    expect(await screen.findByText('L’IA en novembre')).toBeTruthy();
    expect(screen.getByText('Part de vos ventes')).toBeTruthy();
    expect(screen.getByText('Prévu en décembre')).toBeTruthy();
    expect(screen.getByText(/de 258.€ à 393.€ selon les semaines, 3,6.% des ventes/u)).toBeTruthy();
    expect(screen.getByText(/Tout va bien : 335.€ prévus en décembre, 3,6.% de vos ventes/u)).toBeTruthy();
    expect(screen.getByText(/dont 171.€ déjà dépensés/u)).toBeTruthy();
    expect(screen.getByText(/de 7.820.€ de ventes prévues en novembre/u)).toBeTruthy();
    expect(screen.getByRole('img', { name: /Par usage, en décembre : Chatting Reveal 85.%/u })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Chatting Reveal/u })).toBeTruthy();
    expect(screen.getByText('Chatting Reveal')).toBeTruthy();
    expect(screen.getByText('Créatrice A')).toBeTruthy();
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Régler le plafond' })).toBeNull();
  });

  it('turns the verdict amber when the realistic pace goes past the daily cap', async () => {
    serve({
      read: () => ({
        status: 200,
        body: usageFixture({
          forecast: forecastFixture({
            cap: { capEur: 25, reachedAtRealistic: true, reachedWithMoreTraffic: true, nextMonthMaxEur: 775 },
          }),
        }),
      }),
    });
    renderPage();
    const note = await screen.findByRole('note');
    expect(note.textContent).toMatch(/bute chaque jour sur le plafond de 25.€ : décembre s’arrête à 775.€/u);
    expect(within(note).getByRole('link', { name: 'Régler le plafond' })).toBeTruthy();
    expect(screen.getByText('Prévu en décembre, sans plafond')).toBeTruthy();
  });

  it('turns the verdict amber when the AI takes more than one euro of sales in five', async () => {
    const base = forecastFixture();
    serve({
      read: () => ({
        status: 200,
        body: usageFixture({
          forecast: forecastFixture({
            sales: base.sales === null ? null : { ...base.sales, aiShare: 0.24 },
          }),
        }),
      }),
    });
    renderPage();
    const note = await screen.findByRole('note');
    expect(note.textContent).toMatch(/24.% de vos ventes : plus d’un euro sur cinq/u);
    expect(within(note).queryByRole('link')).toBeNull();
  });

  it('says the AI hit the cap on days it was stopped, the need being higher than the forecast', async () => {
    const base = usageFixture();
    serve({
      read: () => ({
        status: 200,
        body: usageFixture({
          days: base.days.map((d) =>
            d.day >= '2026-11-08' && d.day < '2026-11-11'
              ? { ...d, eur: 25, providers: [{ provider: 'xai', eur: 25, coveredEur: 0 }], coveredEur: 0 }
              : d,
          ),
        }),
      }),
    });
    renderPage();
    const note = await screen.findByRole('note');
    expect(note.textContent).toMatch(/a buté sur le plafond de 25.€ 3 jours sur les 14 derniers/u);
    expect(within(note).getByRole('link', { name: 'Régler le plafond' })).toBeTruthy();
  });

  it('waits for a first full day before forecasting', async () => {
    serve({ read: () => ({ status: 200, body: usageFixture({ forecast: null }) }) });
    renderPage();
    expect(
      await screen.findByText(/Le prévisionnel apparaît après une première journée complète/u),
    ).toBeTruthy();
  });
});
