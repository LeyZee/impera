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
  totals: [
    {
      currency: 'EUR',
      sales: 2,
      refunds: 1,
      grossInclVatMinor: 6000,
      grossExclVatMinor: 5000,
      netMinor: 4000,
      agencyMinor: 1550,
      creatorMinor: 2450,
      shareOfNetBp: 6125,
      agencyShareOfNetBp: 3875,
      shareOfPaidBp: 4083,
    },
  ],
  lines: [
    {
      occurredAt: '2026-11-03T11:40:00.000Z',
      saleDay: '2026-11-02',
      event: 'refund',
      saleType: 'ppv',
      currency: 'EUR',
      grossInclVatMinor: 1200,
      grossExclVatMinor: 1000,
      netMinor: 800,
      agencyMinor: 200,
      creatorMinor: 600,
      shareOfNetBp: 7500,
      fanName: null,
    },
    {
      occurredAt: '2026-11-03T10:05:00.000Z',
      saleDay: '2026-11-03',
      event: 'sale',
      saleType: 'ppv',
      currency: 'EUR',
      grossInclVatMinor: 6000,
      grossExclVatMinor: 5000,
      netMinor: 4000,
      agencyMinor: 1550,
      creatorMinor: 2450,
      shareOfNetBp: 6125,
      fanName: 'loup_bleu',
    },
    {
      occurredAt: '2026-11-03T08:00:00.000Z',
      saleDay: '2026-11-03',
      event: 'sale',
      saleType: 'tip',
      currency: 'EUR',
      grossInclVatMinor: 1200,
      grossExclVatMinor: 1000,
      netMinor: 800,
      agencyMinor: 200,
      creatorMinor: 600,
      shareOfNetBp: 7500,
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

describe('« Ta part », her Ventes (CR-04, ADR 0157)', () => {
  it('says her part of today in large, where her fans’ money went, and each sale with what it paid', async () => {
    serve();
    show();
    const card = (
      await screen.findByText(/^24,50\s€$/u, { selector: '.vt-earn__part' })
    ).closest<HTMLElement>('.vt-earn');
    if (card === null) throw new Error('no card');
    const plain = (text: string | null): string => (text ?? '').replace(/\s/gu, ' ');
    expect(plain(card.textContent)).toContain('Aujourd’hui');
    expect(plain(card.textContent)).toContain(
      '2 ventes · 1 remboursement · estimé, période en cours · lu chez Reveal',
    );
    expect(plain(card.textContent)).toContain('61,3 % du net');
    expect(plain(card.textContent)).toContain('Sur 100 € payés par tes fans, 40,83 € pour toi.');
    const path = within(card).getByRole('region', { name: 'Où va l’argent' });
    expect(
      within(path)
        .getAllByRole('term')
        .map((term) => plain(term.textContent)),
    ).toEqual(['Payé par tes fans', 'TVA', 'Reveal', 'Agence38,8 % du net', 'Toi61,3 % du net']);
    expect(
      within(path)
        .getAllByRole('definition')
        .map((amount) => plain(amount.textContent)),
    ).toEqual(['60 €', '−10 €', '−10 €', '−15,50 €', '24,50 €']);
    const rows = within(card).getAllByRole('button', { expanded: false });
    expect(rows.map((row) => plain(row.textContent))).toEqual([
      '12 h 40Remboursementd’une vente du 2 nov.rendu 12 €−6 €',
      '11 h 05Message débloquéloup_bleupayé 60 €+24,50 €',
      '9 hPourboirepayé 12 €+6 €',
    ]);
    // A sale unfolds its own path, her share of its net beside her part.
    fireEvent.click(rows[1] ?? card);
    const detail = within(card).getByRole('button', { expanded: true }).closest('li');
    expect(plain(detail?.querySelector('ul')?.textContent ?? '')).toBe(
      'TVA10 €Reveal10 €Agence15,50 €Toi24,50 € · 61,3 % du net',
    );
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
