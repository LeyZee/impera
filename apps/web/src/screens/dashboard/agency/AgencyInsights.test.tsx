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

import { AgencyInsightsPanel } from './AgencyInsights';
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
        period="week"
        onPeriod={() => undefined}
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
    expect(reads[0]).toBe('/v1/dashboard/agency?period=week');
    for (const title of [
      'D’où vient l’argent',
      'Qui vend',
      'Qui a vendu',
      'Les créatrices',
      'Quand ça vend',
    ]) {
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

  it('says a chatter nobody linked under his line, in the screen’s tip, and leads to Équipe › Reveal (ADM-06)', async () => {
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
    const card = screen.getByRole('heading', { name: /Qui vend/u }).closest('article');
    if (card === null) throw new Error('card');
    const row = within(card).getByRole('button', { name: /Chatteur non relié/u });
    // No title of the browser: the tip of the screen says it, to the keyboard too.
    expect(row.getAttribute('title')).toBeNull();
    act(() => {
      row.focus();
    });
    expect(screen.getByRole('tooltip').textContent).toContain('Équipe › Reveal');
  });

  it('shows no « 0 % » next to a zero that was already zero, and says there was no refund (ADM-07)', async () => {
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
    expect(within(tile).getByText('aucun remboursement')).toBeTruthy();
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
    expect(tile('Part de l’agence').textContent).toContain('40 % du net');
    expect(tile('Part des créatrices').textContent).toContain('60 % du net');
    const vat = tile('TVA en plus sur les virements').textContent;
    expect(vat).toContain('118,14');
    expect(vat).toContain('estimation');
    expect(vat).toContain('à reverser à l’État');
    const split = screen.getByRole('img', { name: /Où va l’argent/u });
    expect(split.getAttribute('aria-label')).toContain('TVA payée par les fans');
    expect(split.getAttribute('aria-label')).toContain('Commission de la plateforme');
    expect(split.getAttribute('aria-label')).not.toContain('virements');
  });

  it('reads one creator alone, without the creators side by side', async () => {
    serve(200, {
      ...AGENCY_WEEK,
      creators: [AGENCY_WEEK.creators[0]],
      byCreator: [AGENCY_WEEK.byCreator[0]],
    });
    show(LINA);
    expect(await screen.findByRole('heading', { name: /Qui vend/u })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Les chiffres de Lina Test/u })).toBeTruthy();
    expect(reads[0]).toBe(`/v1/dashboard/agency?period=week&creatorId=${LINA}`);
    expect(screen.queryByRole('heading', { name: /Les créatrices/u })).toBeNull();
    expect(within(screen.getByLabelText('L’argent')).getByText('Part de la créatrice')).toBeTruthy();
  });

  it('says nothing is linked yet, never a made-up figure, and leads the owner to Réglages', async () => {
    serve(200, { ...AGENCY_WEEK, creators: [], byCreator: [], sellers: [], kinds: [] });
    show();
    expect(await screen.findByText(/Aucune créatrice n’est encore reliée/u)).toBeTruthy();
    expect(screen.getByRole('link', { name: /Réglages › Ventes/u })).toBeTruthy();
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
    expect(await screen.findByText(/Les chiffres reviennent dès qu’il répond/u)).toBeTruthy();
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

  it('waits for the first read when the snapshot is empty', async () => {
    serve(200, { ...AGENCY_WEEK, subscribers: null });
    show();
    expect(await screen.findByText(/première lecture des statistiques de Reveal/u)).toBeTruthy();
  });
});
