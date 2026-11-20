// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useFloatingTip } from '../parts';

import { AgencyInsightsPanel, readingOf, sparkValues } from './AgencyInsights';
import { AGENCY_WEEK, LINA } from './fixture';

const reads: string[] = [];

function serve(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      reads.push(input);
      return Promise.resolve(new Response(JSON.stringify(body), { status }));
    }),
  );
}

function Panel({ creatorId, canOpenSettings }: { creatorId: string | null; canOpenSettings: boolean }) {
  const tip = useFloatingTip();
  return (
    <>
      <AgencyInsightsPanel
        selection={{ unit: 'week' }}
        onSelection={() => undefined}
        creatorId={creatorId}
        creatorName="Lina Test"
        canOpenSettings={canOpenSettings}
        tip={tip}
      />
      {tip.element}
    </>
  );
}

function show(creatorId: string | null = null, canOpenSettings = true): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <div>
        <Panel creatorId={creatorId} canOpenSettings={canOpenSettings} />
      </div>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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
});

afterEach(() => {
  cleanup();
  reads.length = 0;
  vi.unstubAllGlobals();
});

describe('L’agence en chiffres (ADR 0078)', () => {
  it('reads the agency’s week from the server and says it in sections, rings and a ranking', async () => {
    serve(200, AGENCY_WEEK);
    show();
    expect(await screen.findByRole('heading', { name: /D’où vient l’argent/u })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /L’agence en chiffres/u })).toBeTruthy();
    expect(reads[0]).toBe('/v1/dashboard/agency?unit=week');
    // « Qui vend » said the ranking again: one card now (PIL-02).
    expect(screen.queryByRole('heading', { name: /Qui vend/u })).toBeNull();
    for (const title of ['D’où vient l’argent', 'Qui a vendu', 'Les créatrices', 'Quand ça vend']) {
      expect(screen.getByRole('heading', { name: new RegExp(title, 'u') })).toBeTruthy();
    }
    const ranking = screen.getByRole('list', { name: 'Classement de qui a vendu' });
    expect(within(ranking).getByText('Théo')).toBeTruthy();
    expect(within(ranking).getByText('Agent IA')).toBeTruthy();
    expect(screen.getByText(/Les 10 fans qui dépensent le plus/u).textContent).toContain('58');
    // The hours as the rest of the CRM writes them (ADM-08).
    const slot = screen.getByText(/^21\sh\s–\s0\sh$/u, { selector: 'b' });
    expect(slot.textContent).toBe('21\u00a0h\u00a0–\u00a00\u00a0h');
  });

  it('says in a ring’s middle the euros it cuts, not a count of sales (ADM-05)', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const card = (await screen.findByRole('heading', { name: /D’où vient l’argent/u })).closest('article');
    if (card === null) throw new Error('card');
    expect(card.querySelector('.ins-ring__value')?.textContent).toMatch(/€$/u);
    expect(card.querySelector('.ins-ring__sub')?.textContent).toBe('au total');
    expect(within(card).queryByText('ventes')).toBeNull();
  });

  it('says a chatter nobody linked under his line, in the screen’s tip, and leads to Équipe › Comptes Reveal (ADM-06)', async () => {
    const unlinked = {
      seller: { kind: 'unlinked' },
      revenueMinor: 37_200,
      revenueExclVatMinor: 31_000,
      netMinor: 29_760,
      agencyMinor: 11_160,
      creatorMinor: 18_600,
      agencyTransferVatMinor: 2_232,
      sales: 11,
      refunds: 0,
      previousRevenueMinor: 0,
    };
    serve(200, { ...AGENCY_WEEK, sellers: [...AGENCY_WEEK.sellers, unlinked] });
    show();
    const ranking = await screen.findByRole('list', { name: 'Classement de qui a vendu' });
    expect(within(ranking).getByText(/11 ventes d’un compte Reveal que personne n’a relié/u)).toBeTruthy();
    expect(within(ranking).getByRole('link', { name: 'Relier' }).getAttribute('href')).toBe('/equipe/reveal');
    const row = within(ranking).getByText('Chatteur non relié').closest('li');
    if (row === null) throw new Error('row');
    // No title of the browser: the tip of the screen says it, to the keyboard too.
    expect(row.getAttribute('title')).toBeNull();
    act(() => {
      row.focus();
    });
    expect(screen.getByRole('tooltip').textContent).toContain('Équipe › Comptes Reveal');
  });

  it('ranks the sellers first, the sales of no seller at the bottom, unranked and under a rule (PIL-03)', async () => {
    const [theo, agent, none] = AGENCY_WEEK.sellers;
    if (theo === undefined || agent === undefined || none === undefined) throw new Error('fixture');
    // « Sans chatteur » made the most: it still comes last.
    serve(200, { ...AGENCY_WEEK, sellers: [{ ...none, revenueMinor: 500_000 }, agent, theo] });
    show();
    const ranking = await screen.findByRole('list', { name: 'Classement de qui a vendu' });
    const rows = within(ranking).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.ins-rank__name')?.textContent)).toEqual([
      'Théo',
      'Agent IA',
      'Sans chatteur',
    ]);
    expect(rows.map((row) => row.querySelector('.ins-rank__pos')?.textContent)).toEqual(['1', '2', '']);
    expect(rows.map((row) => row.hasAttribute('data-rule'))).toEqual([false, false, true]);
  });

  it('waits in the shape of what comes: four tiles of money, the card of the split, two of the sales (ADM-21)', async () => {
    // A server that never answers: the placeholders stay.
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    show();
    const waiting = await screen.findByRole('status', { name: 'Chargement des chiffres' });
    const rows = waiting.querySelectorAll('.ins-tiles');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelectorAll('.ins-loading--tile')).toHaveLength(4);
    expect(rows[1]?.querySelectorAll('.ins-loading--tile')).toHaveLength(2);
    expect(waiting.querySelectorAll('.ins-loading--split')).toHaveLength(1);
  });

  it('shows no « 0 % » next to a zero that was already zero, nor a line that says the zero again (ADM-07, PIL-21)', async () => {
    const totals = {
      current: { ...AGENCY_WEEK.totals.current, refunds: 0 },
      previous: { ...AGENCY_WEEK.totals.previous, refunds: 0 },
    };
    serve(200, { ...AGENCY_WEEK, totals });
    show();
    const label = await screen.findByText('Remboursements', { selector: 'dt' });
    const tile = label.closest<HTMLElement>('.ins-tile');
    if (tile === null) throw new Error('tile');
    expect(tile.querySelector('.nv-delta')).toBeNull();
    expect(within(tile).queryByText('aucun remboursement')).toBeNull();
    expect(tile.querySelector('.ins-tile__note')).toBeNull();
  });

  it('says the paying fans once, in « Les fans qui paient », and two figures by the money (PIL-21)', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const sales = await screen.findByLabelText('Les ventes');
    expect(Array.from(sales.querySelectorAll('dt'), (term) => term.textContent)).toEqual([
      'Ventes',
      'Remboursements',
    ]);
    expect(screen.getAllByText('Fans qui ont payé')).toHaveLength(1);
    expect(screen.getAllByText(/^Dépense moyenne/u)).toHaveLength(1);
  });

  it('walks the map of the hours with the arrows, one stop, each cell saying its hour and its amount (ADM-09)', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const map = await screen.findByRole('group', { name: /par jour de la semaine et par heure/u });
    const cells = within(map).getAllByRole('button');
    expect(cells).toHaveLength(7 * 24);
    const stops = cells.filter((cell) => cell.tabIndex === 0);
    expect(stops).toHaveLength(1);
    const stop = stops[0];
    if (stop === undefined) throw new Error('no stop');
    // The peak of the fixture: Sunday, 0 h.
    expect(stop.getAttribute('aria-label')).toBe('Dimanche, 0\u00a0h\u00a0–\u00a01\u00a0h : 27\u00a0€');
    stop.focus();
    fireEvent.keyDown(stop, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Dimanche, 1\u00a0h/u);
    fireEvent.keyDown(document.activeElement ?? stop, { key: 'ArrowUp' });
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Samedi, 1\u00a0h/u);
  });

  it("gives the money on tiles of its own, the parts in shares of the net, the transfers' VAT apart (ADR 0106)", async () => {
    serve(200, AGENCY_WEEK);
    show();
    const money = await screen.findByLabelText('L’argent');
    const tile = (label: string): HTMLElement => {
      const term = within(money).getByText(label);
      const box = term.parentElement;
      if (box === null) throw new Error(label);
      return box;
    };
    expect(tile('Part de l’agence').textContent).toContain('40\u00a0% du net');
    expect(tile('Part des créatrices').textContent).toContain('60\u00a0% du net');
    const vat = tile('TVA en plus sur les virements').textContent;
    expect(vat).toContain('118,14');
    expect(vat).toContain('estimation');
    expect(vat).toContain('à reverser à l’État');
    const split = screen.getByRole('img', { name: /Où va l’argent/u });
    expect(split.getAttribute('aria-label')).toContain('TVA payée par les fans');
    expect(split.getAttribute('aria-label')).toContain('Commission de la plateforme');
    expect(split.getAttribute('aria-label')).not.toContain('virements');
  });

  it('says shares of a ring that add up to 100 %, in its legend and to a screen reader', async () => {
    // Rounded alone: 33 + 33 + 33 = 99 %.
    serve(200, {
      ...AGENCY_WEEK,
      kinds: [
        { kind: 'subscriptions', revenueMinor: 10_000, sales: 4, previousRevenueMinor: 10_000 },
        { kind: 'ppv', revenueMinor: 10_000, sales: 4, previousRevenueMinor: 10_000 },
        { kind: 'tips', revenueMinor: 10_000, sales: 4, previousRevenueMinor: 10_000 },
      ],
    });
    show();
    const ring = await screen.findByRole('img', { name: /^D’où vient l’argent/u });
    const card = ring.closest('article');
    if (card === null) throw new Error('card');
    const shares = Array.from(card.querySelectorAll('.ins-legend__share'), (one) =>
      Number.parseInt(one.textContent, 10),
    );
    expect(shares).toEqual([34, 33, 33]);
    expect(ring.getAttribute('aria-label')).toMatch(/34 %.*33 %.*33 %/u);
  });

  it('says shares of « Où va l’argent » that add up to 100 %, the amounts as the platform gave them', async () => {
    // Rounded alone: 17 + 17 + 42 + 25 = 101 % (recette du 13/11).
    serve(200, {
      ...AGENCY_WEEK,
      totals: {
        ...AGENCY_WEEK.totals,
        current: {
          ...AGENCY_WEEK.totals.current,
          revenueMinor: 10_000,
          revenueExclVatMinor: 8_330,
          netMinor: 6_660,
          agencyMinor: 2_490,
          creatorMinor: 4_170,
        },
      },
    });
    show();
    const split = await screen.findByRole('img', { name: /Où va l’argent/u });
    const card = split.closest('article');
    if (card === null) throw new Error('card');
    const shares = Array.from(card.querySelectorAll('.ins-money__share'), (one) =>
      Number.parseInt(one.textContent, 10),
    );
    expect(shares).toEqual([17, 17, 41, 25]);
    expect(shares.reduce((sum, one) => sum + one, 0)).toBe(100);
    expect(card.textContent).toContain('41,70');
  });

  it('reads one creator alone, without the creators side by side', async () => {
    serve(200, {
      ...AGENCY_WEEK,
      creators: [AGENCY_WEEK.creators[0]],
      byCreator: [AGENCY_WEEK.byCreator[0]],
    });
    show(LINA);
    expect(await screen.findByRole('heading', { name: /Qui a vendu/u })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Les chiffres de Lina Test/u })).toBeTruthy();
    expect(reads[0]).toBe(`/v1/dashboard/agency?unit=week&creatorId=${LINA}`);
    expect(screen.queryByRole('heading', { name: /Les créatrices/u })).toBeNull();
    expect(within(screen.getByLabelText('L’argent')).getByText('Part de la créatrice')).toBeTruthy();
  });

  it('says nothing is linked yet, never a made-up figure, and leads the owner to Réglages', async () => {
    serve(200, { ...AGENCY_WEEK, creators: [], byCreator: [], sellers: [], kinds: [] });
    show();
    expect(await screen.findByText(/Aucune créatrice n’est encore reliée/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Réglages › Plateformes/u })).toBeTruthy();
    expect(screen.queryByText('Chiffre d’affaires')).toBeNull();
  });

  it('says dollars are left out without a rate, and refunds without their sale', async () => {
    serve(200, { ...AGENCY_WEEK, dollarsLeftOut: true, refundsWithoutSale: 2 });
    show();
    expect(await screen.findByText(/Des ventes en dollars sont laissées de côté/u)).toBeTruthy();
    expect(screen.getByText(/2 remboursements de la période/u)).toBeTruthy();
  });

  it('says the server is silent and offers to read again', async () => {
    serve(500, { error: 'internal' });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('walks the chart’s columns with the arrows, one stop for the keyboard', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const chart = await screen.findByRole('group', { name: /Chiffre d’affaires jour par jour/u });
    const columns = within(chart).getAllByRole('button');
    expect(columns.filter((column) => column.tabIndex === 0)).toHaveLength(1);
    const last = columns[columns.length - 1];
    if (last === undefined) throw new Error('no column');
    last.focus();
    fireEvent.keyDown(last, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(columns[columns.length - 2]);
  });

  it('lights a ring’s slice on a finger’s tap on its legend, as on a mouse’s hover', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const card = (await screen.findByRole('heading', { name: /D’où vient l’argent/u })).closest('article');
    if (card === null) throw new Error('card');
    const row = within(card).getByRole('button', { name: /PPV en privé/u });
    // A tap: the pointer enters, presses, focuses, then clicks. The click must not put out what entering lit.
    const tap = (): void => {
      fireEvent.pointerEnter(row, { pointerType: 'touch' });
      fireEvent.pointerDown(row, { pointerType: 'touch' });
      fireEvent.focus(row);
      fireEvent.click(row);
    };
    tap();
    expect(row.className).toContain('is-on');
    tap();
    expect(row.className).not.toContain('is-on');
  });

  it("opens a money tile's tip on a tap, to the cent and beside the period before, and closes it on a second tap (ADR 0106 § 12, § 13)", async () => {
    serve(200, AGENCY_WEEK);
    show();
    const money = await screen.findByLabelText('L’argent');
    const tile = within(money).getByText('Part de l’agence').closest('.ins-tile');
    if (!(tile instanceof HTMLElement)) throw new Error('tile');
    fireEvent.pointerDown(tile, { pointerType: 'touch' });
    const tipText = (): string => document.querySelector('.nv-tip.is-on')?.textContent ?? '';
    await vi.waitFor(() => {
      expect(tipText()).toContain('Période d’avant');
    });
    expect(tipText()).toContain('590,72');
    expect(tipText()).toContain('499,20');
    expect(tipText()).toContain('Part du net');
    fireEvent.pointerDown(tile, { pointerType: 'touch' });
    await vi.waitFor(() => {
      expect(tipText()).not.toContain('Période d’avant');
    });
  });

  it('gives the revenue tile its tip too, to the cent against the period before (ADR 0106 § 12, PAY-16)', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const label = await screen.findByText('Chiffre d’affaires', { selector: '.nv-figure__label' });
    // On the figure, not the whole card: the curve under it keeps its own reading of a day.
    const lead = label.closest('.nv-figure');
    if (!(lead instanceof HTMLElement)) throw new Error('lead');
    expect(lead.closest('.ins-lead')?.hasAttribute('tabindex')).toBe(false);
    expect(lead.tabIndex).toBe(0);
    fireEvent.pointerDown(lead, { pointerType: 'touch' });
    const tipText = (): string => document.querySelector('.nv-tip.is-on')?.textContent ?? '';
    await vi.waitFor(() => {
      expect(tipText()).toContain('Période d’avant');
    });
    expect(tipText()).toContain('Montant');
    expect(tipText()).not.toContain('Part du chiffre d’affaires');
  });

  it('names as many biggest fans as there are, never « 10 » for three (PAY-16)', async () => {
    serve(200, { ...AGENCY_WEEK, fans: { ...AGENCY_WEEK.fans, paying: 3, topTenShare: 100 } });
    show();
    expect(await screen.findByText(/Les 3 fans qui dépensent le plus font/u)).toBeTruthy();
    expect(screen.queryByText(/Les 10 fans/u)).toBeNull();
    expect(screen.getByRole('img', { name: '100 % fait par les 3 plus gros fans' })).toBeTruthy();
  });

  it('draws no conclusion from too few sales, and keeps every figure (ADR 0092 § 5)', async () => {
    const current = { ...AGENCY_WEEK.totals.current, sales: 4 };
    serve(200, { ...AGENCY_WEEK, totals: { ...AGENCY_WEEK.totals, current } });
    show();
    const map = await screen.findByRole('group', { name: /par jour de la semaine et par heure/u });
    // The slot, the peak and the concentration are not written; the sentence that says why is, twice.
    expect(screen.queryByText(/Le créneau qui rapporte le plus/u)).toBeNull();
    expect(screen.queryByText(/concentré|Bien réparti/u)).toBeNull();
    expect(screen.getAllByText('Pas encore assez de ventes pour conclure.')).toHaveLength(2);
    // The figures stay: the map, the meter, the paying and new payers.
    expect(within(map).getAllByRole('button')).toHaveLength(7 * 24);
    expect(screen.getByText(/Les 10 fans qui dépensent le plus/u).textContent).toContain('58');
    expect(screen.getByText('Nouveaux payeurs')).toBeTruthy();
  });

  it('draws no conclusion before the registers hold enough days of the period (ADR 0092 § 5)', async () => {
    serve(200, { ...AGENCY_WEEK, registerSince: '2026-11-04' });
    show();
    await screen.findByRole('group', { name: /par jour de la semaine et par heure/u });
    expect(screen.queryByText(/Le créneau qui rapporte le plus/u)).toBeNull();
    // Too little hindsight is said as such, not as too few sales (Charles, 20/11).
    expect(screen.getAllByText('Pas encore assez de recul pour conclure.')).toHaveLength(2);
    expect(screen.queryByText('Pas encore assez de ventes pour conclure.')).toBeNull();
  });

  it('lights the best slot in one hue, and greys the map while it cannot conclude', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const map = await screen.findByRole('group', { name: /par jour de la semaine et par heure/u });
    const plate = map.closest('.ins-hours');
    expect(plate?.hasAttribute('data-pending')).toBe(false);
    // One ring over the slot's three hours, every day of the week.
    expect(map.querySelectorAll('.ins-heat__best')).toHaveLength(1);
    cleanup();
    const current = { ...AGENCY_WEEK.totals.current, sales: 4 };
    serve(200, { ...AGENCY_WEEK, totals: { ...AGENCY_WEEK.totals, current } });
    show();
    const grey = await screen.findByRole('group', { name: /par jour de la semaine et par heure/u });
    expect(grey.closest('.ins-hours')?.hasAttribute('data-pending')).toBe(true);
    expect(document.querySelector('.ins-fans')?.hasAttribute('data-pending')).toBe(true);
    expect(grey.querySelectorAll('.ins-heat__best')).toHaveLength(0);
  });

  it('lists the refunds one by one, filtered by creator and by the sale’s chatter (ADR 0092 § 4)', async () => {
    serve(200, AGENCY_WEEK);
    show();
    const table = await screen.findByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(1 + 3);
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Date', 'Créatrice', 'Type', 'Montant', 'Chatteur de la vente', 'Délai depuis la vente']);
    const [, first, second, third] = rows.map((row) => row.textContent);
    expect(first).toContain('6 nov.');
    expect(first).toContain('14\u00a0h\u00a005');
    expect(first).toContain('Lina Test');
    expect(first).toContain('PPV en privé');
    expect(first).toContain('25,00');
    expect(first).toContain('Théo');
    expect(first).toContain('2 jours après');
    expect(second).toContain('le jour même');
    expect(second).toContain('Sans chatteur');
    expect(third).toContain('vente hors registre');
    expect(third).toContain('Agent IA');
    expect(third).toContain('—');

    fireEvent.click(screen.getByRole('combobox', { name: 'Créatrice' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Maya Démo' }));
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(1 + 1);
    fireEvent.click(screen.getByRole('combobox', { name: 'Chatteur de la vente' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Théo' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Aucun remboursement pour ce choix.')).toBeTruthy();
  });

  it('shows no refunds card on a period without one', async () => {
    serve(200, { ...AGENCY_WEEK, refundList: [] });
    show();
    await screen.findByRole('heading', { name: /Les fans qui paient/u });
    expect(screen.queryByRole('heading', { name: /Les remboursements/u })).toBeNull();
  });

  it('shows nothing to an account whose scope is its own', async () => {
    serve(403, { error: 'creator_forbidden' });
    show(null, false);
    await vi.waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('Les abonnés (ADR 0081)', () => {
  it('shows active subscribers, their change, the counts and when Reveal was read', async () => {
    serve(200, AGENCY_WEEK);
    show();
    expect(await screen.findByRole('heading', { name: /Les abonnés/u })).toBeTruthy();
    expect(screen.getByText('Abonnés actifs')).toBeTruthy();
    // 1 284 now, 1 231 the day before the week.
    expect(screen.getByText('+53', { selector: 'b' })).toBeTruthy();
    expect(screen.getByText('Désabonnements')).toBeTruthy();
    // 96 new, 43 gone.
    expect(screen.getByText('+53', { selector: '.ins-tile__value' })).toBeTruthy();
    expect(screen.getByText('18 %')).toBeTruthy();
    expect(screen.getByText(/74 achetés sur 412 envoyés, Mass DM compris/u)).toBeTruthy();
    expect(screen.getByText(/Lu chez Reveal à/u)).toBeTruthy();
    expect(
      screen.getByRole('img', { name: /Abonnés actifs jour par jour, de 1\s236 à 1\s284/u }),
    ).toBeTruthy();
  });

  it('says a count is still computed and how many days are read, never a zero', async () => {
    const subscribers = AGENCY_WEEK.subscribers;
    if (subscribers === null) throw new Error('fixture');
    serve(200, {
      ...AGENCY_WEEK,
      subscribers: {
        ...subscribers,
        current: { ...subscribers.current, unsubscribes: null, messagesSent: null, daysRead: 5 },
        days: subscribers.days.map((one, i) => (i === 3 ? { ...one, active: null } : one)),
      },
    });
    show();
    expect(await screen.findByRole('heading', { name: /Les abonnés/u })).toBeTruthy();
    expect(screen.getAllByText('en calcul chez Reveal').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/5 jours lus sur 7/u)).toBeTruthy();
    expect(screen.getByRole('img', { name: /1 jour pas encore lu/u })).toBeTruthy();
  });

  it('compares the PPV purchase rate in points, never a percent of a percent', async () => {
    const subscribers = AGENCY_WEEK.subscribers;
    if (subscribers === null) throw new Error('fixture');
    serve(200, {
      ...AGENCY_WEEK,
      subscribers: { ...subscribers, previous: { ...subscribers.previous, ppvSent: 400, ppvPurchased: 88 } },
    });
    show();
    expect(await screen.findByText('Achat des PPV')).toBeTruthy();
    // 18 % now (74 on 412), 22 % before (88 on 400).
    expect(screen.getByText(/−4\spts/u)).toBeTruthy();
  });

  it('compares nothing to a period before that is only partly read', async () => {
    const subscribers = AGENCY_WEEK.subscribers;
    if (subscribers === null) throw new Error('fixture');
    serve(200, {
      ...AGENCY_WEEK,
      subscribers: { ...subscribers, previous: { ...subscribers.previous, daysRead: 2 } },
    });
    show();
    const heading = await screen.findByRole('heading', { name: /Les abonnés/u });
    const block = heading.closest('section');
    if (block === null) throw new Error('section');
    expect(block.querySelectorAll('.nv-delta')).toHaveLength(0);
  });

  it('says the last count read with its day, and draws no chart of a lone point (PIL-08)', async () => {
    const subscribers = AGENCY_WEEK.subscribers;
    if (subscribers === null) throw new Error('fixture');
    const last = subscribers.days.length - 1;
    serve(200, {
      ...AGENCY_WEEK,
      subscribers: {
        ...subscribers,
        current: { ...subscribers.current, activeAtEnd: null },
        // One day read, the second to last: nothing to draw a line with.
        days: subscribers.days.map((one, i) => (i === last - 1 ? one : { ...one, active: null })),
      },
    });
    show();
    const heading = await screen.findByRole('heading', { name: /Les abonnés/u });
    const block = heading.closest('section');
    if (block === null) throw new Error('section');
    const day = subscribers.days[last - 1];
    if (day === undefined || day.active === null) throw new Error('fixture');
    expect(block.querySelector('.ins-subs .ins-lead__value')?.textContent).toBe(
      day.active.toLocaleString('fr-FR'),
    );
    expect(block.textContent).toContain('le dernier jour lu');
    expect(within(block).queryByRole('img', { name: /Abonnés actifs jour par jour/u })).toBeNull();
    expect(block.querySelector('.ins-subs--flat')).not.toBeNull();
  });

  it('waits for the first read when the snapshot is empty', async () => {
    serve(200, { ...AGENCY_WEEK, subscribers: null });
    show();
    expect(await screen.findByText(/première lecture des statistiques de Reveal/u)).toBeTruthy();
  });
});

describe('the days read and their comparison (ADR 0146)', () => {
  it('names the week, the days compared, and offers the arrows and the comparison', async () => {
    serve(200, AGENCY_WEEK);
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    const heading = screen.getByRole('heading', { name: /L’agence en chiffres/u });
    expect(heading.textContent).toContain('comparé aux 24–30 oct.');
    expect(screen.getByRole('radio', { name: 'Semaine' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('button', { name: 'Période précédente' })).toBeTruthy();
    // The next week has begun by the fixture's today: it can be read.
    expect(screen.getByRole('button', { name: 'Période suivante' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('vs semaine précédente')).toBeTruthy();
  });

  it('draws the curve with its comparison and reads a day in the lead’s note, in place, with no floating tip', async () => {
    serve(200, AGENCY_WEEK);
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    const plot = document.querySelector('.ins-curve__plot');
    if (plot === null) throw new Error('curve');
    expect(plot.querySelector('.ins-curve__compared')).not.toBeNull();
    const layer = plot.querySelector('.ins-curve__hits');
    const note = document.querySelector('.ins-lead__note');
    if (layer === null || note === null) throw new Error('layer');
    const [rest, read] = Array.from(note.children);
    expect(rest?.textContent).toMatch(/\(1\s560\s€\)/u);
    expect(rest?.getAttribute('aria-hidden')).toBe('false');
    // To the far right: the last day, its revenue and the day compared, on the sentence's line (every media query
    // matches here, a phone's: the day without its weekday, shortened rather than cut).
    fireEvent.pointerMove(layer, { clientX: 10, clientY: 10 });
    expect(read?.textContent).toMatch(/^6 nov\. : 320\s€, contre 270\s€ le 30 oct\.$/u);
    expect(read?.getAttribute('aria-hidden')).toBe('false');
    // The sentence keeps its place, hidden: nothing moves.
    expect(rest?.getAttribute('aria-hidden')).toBe('true');
    expect(plot.querySelector('.ins-curve__hair')).not.toBeNull();
    expect(document.querySelector('.nv-tip.is-on')).toBeNull();
    // Off the curve, the sentence comes back.
    fireEvent.pointerLeave(layer, { pointerType: 'mouse' });
    expect(read?.textContent).toBe('');
    expect(rest?.getAttribute('aria-hidden')).toBe('false');
    expect(plot.querySelector('.ins-curve__hair')).toBeNull();
    // A finger reads the same way, and the day stays when the finger lifts, until a tap off the curve.
    fireEvent.pointerDown(layer, { clientX: 10, clientY: 10, pointerType: 'touch' });
    fireEvent.pointerLeave(layer, { pointerType: 'touch' });
    expect(read?.textContent).toContain('6 nov. : 320');
    fireEvent.pointerDown(document.body, { pointerType: 'touch' });
    expect(read?.textContent).toBe('');
  });

  it('gives the pill the day’s change while a day is read, the period’s again after, none for a day with nothing compared', async () => {
    // The last day falls below its day compared (320 € against 400 €) while the week rises (+18 %).
    const previousDays = AGENCY_WEEK.previousDays.map((one, i) =>
      i === 6 ? { ...one, revenueMinor: 40_000 } : one,
    );
    serve(200, { ...AGENCY_WEEK, previousDays });
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    const layer = document.querySelector('.ins-curve__hits');
    const pill = document.querySelector('.ins-lead__pill');
    if (layer === null || pill === null) throw new Error('pill');
    const [period, day] = Array.from(pill.children);
    expect(period?.textContent).toMatch(/^\+18\s%$/u);
    expect(period?.querySelector('.nv-delta--better')).not.toBeNull();
    expect(period?.getAttribute('aria-hidden')).toBe('false');
    // The last day read: its own change, amber, the period's kept in place, hidden.
    fireEvent.pointerMove(layer, { clientX: 10, clientY: 10 });
    expect(day?.textContent).toMatch(/^−20\s%$/u);
    expect(day?.querySelector('.nv-delta--worse')).not.toBeNull();
    expect(day?.getAttribute('aria-hidden')).toBe('false');
    expect(period?.getAttribute('aria-hidden')).toBe('true');
    // Off the curve: the period's change again.
    fireEvent.pointerLeave(layer, { pointerType: 'mouse' });
    expect(day?.textContent).toBe('');
    expect(period?.getAttribute('aria-hidden')).toBe('false');
    cleanup();
    // A day with nothing compared: no pill, its place kept (the period's, hidden).
    serve(200, { ...AGENCY_WEEK, previousDays: AGENCY_WEEK.previousDays.slice(0, 6) });
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    const again = document.querySelector('.ins-curve__hits');
    if (again === null) throw new Error('layer');
    fireEvent.pointerMove(again, { clientX: 10, clientY: 10 });
    const [kept, none] = Array.from(document.querySelector('.ins-lead__pill')?.children ?? []);
    expect(none?.textContent).toBe('');
    expect(kept?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('.ins-lead__note')?.textContent).toContain('6 nov. : 320');
  });

  it('reads a day with nothing compared as its revenue alone, and a phone’s day without its weekday', () => {
    expect(
      readingOf({ key: 'x', title: 'mar. 10 nov.', brief: '10 nov.', cents: 15_300, compared: null }, true),
    ).toMatch(/^10 nov\. : 153\s€$/u);
    expect(
      readingOf({ key: 'x', title: 'mar. 10 nov.', brief: '10 nov.', cents: 15_300, compared: null }),
    ).toMatch(/^mar\. 10 nov\. : 153\s€$/u);
    expect(
      readingOf({
        key: 'x',
        title: 'mar. 10 nov.',
        brief: '10 nov.',
        cents: 15_300,
        compared: { title: '10 oct.', cents: 26_860 },
      }),
    ).toMatch(/^mar\. 10 nov\. : 153\s€, contre 268,60\s€ le 10 oct\.$/u);
  });

  it('colours the curve by the trend: green above the period compared, amber below, never red (lot couleurs)', async () => {
    serve(200, AGENCY_WEEK);
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    expect(document.querySelector('.ins-curve')?.classList.contains('ins-curve--up')).toBe(true);
    cleanup();
    const lower = {
      ...AGENCY_WEEK.totals,
      current: {
        ...AGENCY_WEEK.totals.current,
        revenueMinor: AGENCY_WEEK.totals.previous.revenueMinor - 1_000,
      },
    };
    serve(200, { ...AGENCY_WEEK, totals: lower });
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    expect(document.querySelector('.ins-curve')?.classList.contains('ins-curve--down')).toBe(true);
    // Nothing to compare with: green, as the « n % » says nothing worse.
    cleanup();
    serve(200, { ...AGENCY_WEEK, totals: lower, registerSince: '2026-11-02' });
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    expect(document.querySelector('.ins-curve')?.classList.contains('ins-curve--up')).toBe(true);
  });

  it('draws one small curve, under the net, in the trend’s colour, hidden from readers (Charles 19/11)', async () => {
    serve(200, AGENCY_WEEK);
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    const sparks = [...document.querySelectorAll('.ins-spark')];
    expect(sparks.map((one) => one.getAttribute('class'))).toEqual(['ins-spark ins-spark--up']);
    for (const one of sparks) expect(one.getAttribute('aria-hidden')).toBe('true');
  });

  it('draws no small curve for one day read hour by hour', () => {
    expect(sparkValues({ ...AGENCY_WEEK, to: AGENCY_WEEK.from }, (day) => day.agencyMinor)).toBeNull();
    expect(sparkValues(AGENCY_WEEK, (day) => day.agencyMinor)).toHaveLength(7);
    // From the register's first day, as the lead curve.
    expect(
      sparkValues({ ...AGENCY_WEEK, registerSince: '2026-11-02' }, (day) => day.agencyMinor),
    ).toHaveLength(5);
  });

  it('shows no percentage when the register starts after the days compared, and says so (§ 4)', async () => {
    serve(200, { ...AGENCY_WEEK, registerSince: '2026-11-02' });
    show();
    await screen.findByRole('heading', { name: /D’où vient l’argent/u });
    expect(screen.getByText(/le registre commence le 2 nov\., rien à comparer/u)).toBeTruthy();
    const first = screen.getByRole('heading', { name: /L’agence en chiffres/u }).closest('section');
    if (first === null) throw new Error('section');
    expect(first.querySelectorAll('.nv-delta')).toHaveLength(0);
    // Said once, under the figure: nothing under the curve repeats it.
    expect(screen.queryByText(/registre lu depuis/u)).toBeNull();
  });
});
