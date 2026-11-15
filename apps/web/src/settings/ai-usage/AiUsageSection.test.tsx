// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { AiUsageSection } from './AiUsageSection';
import { usageFixture } from './fixture';

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
  render(
    <QueryClientProvider client={client}>
      <AiUsageSection now={() => new Date('2026-11-11T13:30:00Z')} />
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
    serve({ read: () => ({ status: 200, body: usageFixture({ credits: [] }) }) });
    renderPage();
    expect(await screen.findByText(/Aucun crédit noté pour l’instant/u)).toBeTruthy();
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
});
