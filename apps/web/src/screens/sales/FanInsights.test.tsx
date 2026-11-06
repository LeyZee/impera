// @vitest-environment jsdom
import { CreatorFanInsightsSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FanInsights } from './FanInsights';
import { DEMO_INSIGHTS } from './insights-fixture';
import { arcsOf, heatOf, slotLabel } from './insights-view';

function serve(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status }))),
  );
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FanInsights />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Reduced motion: the numbers show at once.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Qui sont tes fans » (CR-15, ADR 0074)', () => {
  it('reads an invented base that fits the contract', () => {
    expect(CreatorFanInsightsSchema.parse(DEMO_INSIGHTS)).toEqual(DEMO_INSIGHTS);
  });

  it('shows shares, never a count per case, and lights a case from its legend', async () => {
    serve(200, DEMO_INSIGHTS);
    show();
    expect(await screen.findByText('Leur âge')).toBeDefined();
    expect(screen.getByText('34 ans')).toBeDefined();
    expect(screen.getByText('en moyenne')).toBeDefined();
    expect(screen.getAllByText('Environ 140 de tes fans l’ont dit')).toHaveLength(1);
    const row = screen.getByRole('button', { name: /Île-de-France/u });
    expect(row.textContent).toContain('29 %');
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    // A block under ten fans says so in words, with no ring and no number.
    expect(screen.getByText('Leur situation').closest('article')?.textContent).toContain(
      'Pas encore assez de fans pour le dire.',
    );
    expect(screen.getByText('Panier moyen sur 30 jours')).toBeDefined();
  });

  it('says « moins de 10 » for a count under ten, never the exact count', async () => {
    serve(200, { ...DEMO_INSIGHTS, fans: { total: 10, newLast30Days: null, wroteLast7Days: null } });
    show();
    expect(await screen.findByText('fans en tout')).toBeDefined();
    expect(screen.getAllByText('moins de 10')).toHaveLength(2);
  });

  it('says the figures do not load, with a way to try again', async () => {
    serve(500, null);
    show();
    expect(await screen.findByText(/Les chiffres de tes fans n’ont pas pu être lus/u)).toBeDefined();
  });
});

describe('the geometry', () => {
  it('cuts the ring in arcs that follow each other', () => {
    const arcs = arcsOf([50, 50], 10, 0);
    const half = Math.round(Math.PI * 10 * 100) / 100;
    expect(arcs[0]?.offset).toBe(0);
    expect(arcs[1]?.offset).toBe(-half);
    expect(arcsOf([100], 10)[0]?.dash.startsWith(String(Math.round(2 * Math.PI * 10 * 100) / 100))).toBe(
      true,
    );
  });

  it('says a slot and the strength of a cell', () => {
    expect(slotLabel(7)).toBe('21h–0h');
    expect(heatOf(5, 10)).toBe(0.5);
    expect(heatOf(5, 0)).toBe(0);
  });
});
