// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EarningsCard } from './EarningsCard';

/* Invented sales (ADR 0010). Paris is UTC+1 after 25/10: 12:00Z is 13 h. */
const today = {
  period: 'day',
  from: '2026-11-03',
  to: '2026-11-03',
  estimated: true,
  latest: true,
  totals: [{ currency: 'EUR', creatorMinor: 2450, sales: 2, refunds: 1 }],
  lines: [
    {
      occurredAt: '2026-11-03T11:40:00.000Z',
      event: 'refund',
      saleType: 'ppv',
      currency: 'EUR',
      creatorMinor: 600,
      fanName: null,
    },
    {
      occurredAt: '2026-11-03T10:05:00.000Z',
      event: 'sale',
      saleType: 'ppv',
      currency: 'EUR',
      creatorMinor: 2450,
      fanName: 'loup_bleu',
    },
    {
      occurredAt: '2026-11-03T08:00:00.000Z',
      event: 'sale',
      saleType: 'tip',
      currency: 'EUR',
      creatorMinor: 600,
      fanName: null,
    },
  ],
  linesOmitted: 0,
  refundsWithoutSale: 0,
};

const october = {
  ...today,
  period: 'month',
  from: '2026-10-01',
  to: '2026-10-31',
  estimated: false,
  latest: false,
  totals: [],
  lines: [],
};

function serve(): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn((url: string) => {
    const query = new URLSearchParams(url.split('?')[1] ?? '');
    const body = query.get('period') === 'month' && query.get('day') === '2026-10-31' ? october : today;
    const month = query.get('period') === 'month' && query.get('day') === null;
    return Promise.resolve(
      new Response(
        JSON.stringify(month ? { ...today, period: 'month', from: '2026-11-01', to: '2026-11-30' } : body),
        { status: 200 },
      ),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <EarningsCard />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('« Ta part », her Ventes (CR-04)', () => {
  it('says her part of today in large, estimated and read on Reveal, and each sale with her part only', async () => {
    serve();
    show();
    const card = (await screen.findByText(/^24,50\s€$/u)).closest('section');
    if (card === null) throw new Error('no card');
    const plain = (text: string | null): string => (text ?? '').replace(/\s/gu, ' ');
    expect(plain(card.textContent)).toContain('Aujourd’hui');
    expect(plain(card.textContent)).toContain(
      '2 ventes · 1 remboursement · estimé, la période n’est pas finie · lu chez Reveal',
    );
    const lines = within(card)
      .getAllByRole('listitem')
      .map((line) => plain(line.textContent));
    expect(lines).toEqual([
      '12 h 40Remboursement−6 €',
      '11 h 05Message débloquéloup_bleu+24,50 €',
      '9 hPourboire+6 €',
    ]);
    // No later period while today is the current one.
    expect(screen.getByRole('button', { name: 'Période suivante' }).hasAttribute('disabled')).toBe(true);
  });

  it('walks to a month, then back to the month before, and comes back', async () => {
    const fetcher = serve();
    show();
    await screen.findByText('Aujourd’hui');
    fireEvent.click(screen.getByRole('radio', { name: 'Mois' }));
    await screen.findByText('novembre 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Période précédente' }));
    await screen.findByText('octobre 2026');
    expect(fetcher).toHaveBeenLastCalledWith(
      '/v1/creator-space/earnings?period=month&day=2026-10-31',
      expect.anything(),
    );
    expect(screen.getByText('Aucune vente sur cette période.')).toBeDefined();
    expect(screen.getByText(/^lu chez Reveal$/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Revenir à aujourd’hui' }));
    await waitFor(() => {
      expect(screen.getByText('novembre 2026')).toBeDefined();
    });
  });
});
