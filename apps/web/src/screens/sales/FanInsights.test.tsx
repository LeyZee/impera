// @vitest-environment jsdom
import { CreatorFanInsightsSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FanInsights } from './FanInsights';
import { DEMO_INSIGHTS } from './insights-fixture';
import { heatOf, shareText, slotLabel, waitingLines } from './insights-view';

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
    expect(row.textContent).toContain('29\u00a0%');
    // A click pins the case, even after the pointer has lit it: it never turns it off under the pointer.
    fireEvent.pointerEnter(row);
    fireEvent.click(row);
    expect(row.getAttribute('aria-pressed')).toBe('true');
    // Each cell of « Quand ils t'écrivent » is reachable from the keyboard and says its share.
    const cell = screen.getByRole('button', { name: 'Vendredi, 18h–21h : 4\u00a0%' });
    fireEvent.focus(cell);
    expect(cell.getAttribute('aria-pressed')).toBe('true');
    // A block under its threshold is no empty card: one line says what it waits for (recette CRE-04).
    expect(screen.queryByText('Leur situation')).toBeNull();
    expect(
      screen.getByText(
        'Trop peu de fans t’ont encore dit leur situation : ce chiffre s’affichera dès que dix l’auront dit.',
      ),
    ).toBeDefined();
    expect(screen.getByText('Panier moyen d’un fan qui a payé, sur 30 jours')).toBeDefined();
  });

  it('says one count once when the three are alike (recette visuelle 16/11, CRE-02)', async () => {
    serve(200, { ...DEMO_INSIGHTS, fans: { total: 20, newLast30Days: 20, wroteLast7Days: 20 } });
    show();
    expect(
      await screen.findByText(
        'fans en tout, à peu près autant de nouveaux sur 30 jours et à t’avoir écrit cette semaine',
      ),
    ).toBeDefined();
    expect(document.querySelectorAll('.fi-stat')).toHaveLength(1);
  });

  it('says « moins de 10 » for a count under ten, never the exact count', async () => {
    serve(200, { ...DEMO_INSIGHTS, fans: { total: 10, newLast30Days: null, wroteLast7Days: null } });
    show();
    expect(await screen.findByText('fans en tout')).toBeDefined();
    expect(screen.getAllByText('moins de 10')).toHaveLength(2);
  });

  it('says it once, in one short card, when every block has too few fans (recette CRE-04)', async () => {
    const few = { status: 'too_few' } as const;
    serve(200, {
      ...DEMO_INSIGHTS,
      fans: { total: null, newLast30Days: null, wroteLast7Days: null },
      age: few,
      place: few,
      situation: few,
      job: few,
      spending: few,
      activity: few,
    });
    show();
    expect(await screen.findByText(/Encore trop peu de fans pour le dire/u)).toBeDefined();
    expect(screen.queryByText('moins de 10')).toBeNull();
    expect(document.querySelectorAll('.fi-card')).toHaveLength(0);
  });

  it('with enough fans in all, never says there are too few fans: it names what is missing (recette CRE-04)', async () => {
    const few = { status: 'too_few' } as const;
    serve(200, {
      ...DEMO_INSIGHTS,
      fans: { total: 20, newLast30Days: 20, wroteLast7Days: null },
      age: few,
      place: few,
      situation: few,
      job: few,
      spending: few,
      activity: few,
    });
    show();
    expect(await screen.findByText('fans en tout')).toBeDefined();
    expect(screen.queryByText(/Encore trop peu de fans pour le dire/u)).toBeNull();
    expect(
      screen.getByText(
        'Trop peu de fans t’ont encore dit leur âge, d’où ils sont, leur situation et leur métier : chacun s’affichera dès que dix l’auront dit.',
      ),
    ).toBeDefined();
    expect(document.querySelectorAll('.fi-card')).toHaveLength(0);
  });

  it('says in one sentence that nobody unlocked yet, without a ring at 0 % nor a bar at 100 % (recette CRE-04)', async () => {
    serve(200, {
      ...DEMO_INSIGHTS,
      spending: {
        status: 'enough',
        payingShare: 0,
        averageBasketMinor: null,
        cases: [{ key: 'none', share: 100 }],
      },
    });
    show();
    const none = await screen.findByText('Aucun de tes fans n’a encore débloqué de message.');
    // One sentence fills its row: no half-empty line beside a short card.
    expect(none.closest('article')?.className).toContain('fi-card--full');
    expect(screen.queryByText('ont déjà débloqué')).toBeNull();
    expect(screen.queryByText('Rien débloqué')).toBeNull();
    expect(screen.queryByText(/Panier moyen/u)).toBeNull();
  });

  it('says the figures do not load, with a way to try again', async () => {
    serve(500, null);
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });
});

describe('the geometry', () => {
  it('says what each waiting block counts: facts told, fans in all, fans who wrote', () => {
    expect(waitingLines([])).toEqual([]);
    expect(waitingLines(['job'])).toEqual([
      'Trop peu de fans t’ont encore dit leur métier : ce chiffre s’affichera dès que dix l’auront dit.',
    ]);
    expect(waitingLines(['age', 'situation', 'spending', 'activity'])).toEqual([
      'Trop peu de fans t’ont encore dit leur âge et leur situation : chacun s’affichera dès que dix l’auront dit.',
      'Ce qu’ils débloquent s’affichera à partir de dix fans.',
      'Moins de dix fans t’ont écrit ces 30 derniers jours : leurs heures s’afficheront à partir de dix.',
    ]);
  });

  it('never says « 0 % » for a case that is there', () => {
    expect(shareText(0)).toBe('moins de 1\u00a0%');
    expect(shareText(12)).toBe('12\u00a0%');
  });

  it('says a slot and the strength of a cell', () => {
    expect(slotLabel(7)).toBe('21h–0h');
    expect(heatOf(5, 10)).toBe(0.5);
    expect(heatOf(5, 0)).toBe(0);
  });
});
