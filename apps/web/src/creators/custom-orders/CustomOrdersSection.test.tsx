// @vitest-environment jsdom
import { CreatorIdSchema, CustomOrderViewSchema, type CustomOrderView } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomOrdersSection } from './CustomOrdersSection';

/* An invented creator, fan and neutral prices (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ORDER: CustomOrderView = CustomOrderViewSchema.parse({
  id: '0192f3a0-0000-7000-8000-0000000000a1',
  fanId: '0192f3a0-0000-7000-8000-0000000000b1',
  fanName: 'Basile',
  conversationId: null,
  state: 'awaiting_creator',
  format: 'video',
  supplements: [],
  minutes: 3,
  details: { what: 'test' },
  card: {
    format: 'video',
    supplements: [],
    minutes: 3,
    details: { what: 'test' },
    quote: { kind: 'price', totalMinor: 5000, lines: [] },
    to: 'creator',
    missing: [],
  },
  priceMinor: null,
  depositMinor: null,
  createdAt: '2026-11-21T10:00:00.000Z',
  updatedAt: '2026-11-21T10:00:00.000Z',
  decidedAt: null,
});

/** A fake API keeping her orders and the POSTs it is sent. */
function serve(): { url: string; body: unknown }[] {
  const posts: { url: string; body: unknown }[] = [];
  let current = ORDER;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      if (url.includes('/custom-prices')) return Promise.resolve(new Response('{}', { status: 403 }));
      if (init?.method === 'POST') {
        const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
        posts.push({ url, body });
        current = { ...current, state: 'creator_yes', priceMinor: 5000, depositMinor: 2500 };
        return json(current);
      }
      return json({ orders: [current] });
    }),
  );
  return posts;
}

function renderSection(canAnswer: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CustomOrdersSection creatorId={CREATOR} creatorName="Nora" canAnswer={canAnswer} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Sur mesure › Commandes en cours', () => {
  it('the owner accepts at the price her grid proposes, then sees the deposit', async () => {
    const posts = serve();
    renderSection(true);
    const card = await screen.findByRole('article', { name: 'Basile' });
    expect(within(card).getByText('Attend sa réponse')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '1 demande attend la réponse de Nora' })).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Elle accepte à 50 €' }));
    await waitFor(() => {
      expect(posts).toEqual([
        {
          url: `/v1/creators/${CREATOR}/custom-orders/${ORDER.id}/decision`,
          body: { decision: 'yes', priceMinor: 5000 },
        },
      ]);
    });
    expect(await screen.findByText('50 € · acompte 25 €')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Acompte reçu' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Rien n’attend, 1 commande avance' })).toBeTruthy();
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
  });

  it('a manager reads the same card without a button', async () => {
    serve();
    renderSection(false);
    const card = await screen.findByRole('article', { name: 'Basile' });
    expect(within(card).queryAllByRole('button')).toEqual([]);
  });
});
