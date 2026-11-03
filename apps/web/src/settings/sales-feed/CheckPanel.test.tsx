// @vitest-environment jsdom
import type { SalesFeedCheckReport, SalesFeedOverview, SalesFeedStatus } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { SalesFeedSection } from './SalesFeedSection';

/** 3 November 2026 in Paris: the last fortnight over is 16–31 October. */
const NOW = new Date('2026-11-03T09:00:00.000Z');
const BASE = '/v1/settings/sales-feeds';

function status(patch: Partial<SalesFeedStatus> = {}): SalesFeedStatus {
  return {
    platform: 'reveal',
    state: 'connected',
    capabilities: ['sales', 'stats'],
    verifiedAt: '2026-10-01T08:00:00.000Z',
    lastReadAt: '2026-11-03T08:59:00.000Z',
    lastErrorKind: null,
    message: 'Les ventes et les remboursements de Reveal remontent chaque minute.',
    quarantined: 0,
    webhook: null,
    ...patch,
  };
}

const OVERVIEW: SalesFeedOverview = {
  status: status(),
  models: [
    {
      platformModelId: 'm1',
      handle: 'lune',
      displayName: 'Lune',
      platformAccountId: '00000000-0000-4000-8000-00000000000a',
      linkedBy: null,
      quarantined: 0,
    },
  ],
  accounts: [
    {
      platformAccountId: '00000000-0000-4000-8000-00000000000a',
      handle: 'lune',
      creatorDisplayName: 'Lune',
      linkedTo: 'm1',
    },
  ],
  chatters: [
    {
      platformChatterId: 'c-bot',
      firstName: 'Bot',
      lastName: 'Agence',
      isBot: true,
      isExternal: false,
      removedAt: null,
      platformModelIds: ['m1'],
      link: null,
    },
  ],
  listError: null,
};

const totals = (net: number): SalesFeedCheckReport['total']['register'] => ({
  grossInclVat: Math.round(net * 1.2),
  agency: Math.round(net * 0.45),
  creator: net - Math.round(net * 0.45),
  net,
});

function report(patch: Partial<SalesFeedCheckReport> = {}): SalesFeedCheckReport {
  return {
    platform: 'reveal',
    from: '2026-10-16',
    to: '2026-10-31',
    timeZone: 'Europe/Paris',
    generatedAt: '2026-11-03T09:00:05.000Z',
    registerReadAt: '2026-11-03T08:59:00.000Z',
    verdict: 'match',
    total: { register: totals(10_000), stats: totals(10_000), export: null },
    days: [
      {
        date: '2026-10-20',
        platformModelId: 'm1',
        handle: 'lune',
        linked: true,
        register: totals(10_000),
        stats: totals(10_000),
        export: null,
        differs: [],
      },
    ],
    chatters: [
      {
        platformChatterId: 'c-bot',
        isBot: true,
        link: 'agent',
        register: { net: 10_000, sales: 4 },
        stats: { net: 10_000, sales: 4 },
        differs: false,
      },
    ],
    notes: [],
    ...patch,
  };
}

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown };

function serve(
  routes: Record<string, Handler>,
): Mock<(url: string, init?: RequestInit) => Promise<Response>> {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${url}`];
    const { status: code, body } = handler === undefined ? { status: 404, body: null } : handler(init);
    return Promise.resolve(Response.json(body, { status: code }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const ok =
  (body: unknown): Handler =>
  () => ({ status: 200, body });

function page(
  check: Handler,
  overview: SalesFeedOverview = OVERVIEW,
  lastCheck: Handler = ok({ last: null }),
): ReturnType<typeof serve> {
  const fetch = serve({
    [`GET ${BASE}`]: ok({ feeds: [overview.status] }),
    [`GET ${BASE}/reveal`]: ok(overview),
    [`POST ${BASE}/reveal/check`]: check,
    [`GET ${BASE}/reveal/check`]: lastCheck,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SalesFeedSection />
    </QueryClientProvider>,
  );
  return fetch;
}

const checkBody = (fetch: ReturnType<typeof serve>): unknown => {
  const call = fetch.mock.calls.find(([, init]) => init?.method === 'POST');
  const body = call?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : null;
};

beforeEach(() => {
  // Only the clock: the page's promises and timers run as they do.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Réglages › Ventes, vérification de fiabilité (CRM-02)', () => {
  it('checks the last fortnight over by default, without an export, and says the figures agree', async () => {
    const fetch = page(ok(report()));
    const panel = await screen.findByRole('region', { name: 'Vérification de fiabilité' });
    expect(within(panel).getByRole('radio', { name: 'Du 16 au 31 octobre' })).toHaveProperty('checked', true);
    expect(within(panel).getByRole('radio', { name: 'Du 1er au 15 octobre' })).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Vérifier ces jours' }));
    expect(await within(panel).findByText('Les chiffres concordent au centime')).toBeTruthy();
    expect(checkBody(fetch)).toEqual({ from: '2026-10-16', to: '2026-10-31', export: null });
    expect(
      within(panel).getByText(
        /^Vérifié à l’instant · du 16 au 31 octobre, jours de Reveal \(heure de Paris\) · registre lu 1 min avant$/u,
      ),
    ).toBeTruthy();
    expect(within(panel).getByText('Aucun jour en écart')).toBeTruthy();
    expect(
      within(panel).getByText('Sans export, le registre n’est comparé qu’aux statistiques.'),
    ).toBeTruthy();
  });

  it('shows each gap: the day, the model, the figure and how far it is from the register', async () => {
    const off = report({
      verdict: 'mismatch',
      total: { register: totals(10_000), stats: { ...totals(10_000), net: 10_120 }, export: null },
      days: [
        {
          date: '2026-10-20',
          platformModelId: 'm1',
          handle: 'lune',
          linked: true,
          register: totals(10_000),
          stats: { ...totals(10_000), net: 10_120 },
          export: null,
          differs: ['stats'],
        },
      ],
      chatters: [
        {
          platformChatterId: 'c-bot',
          isBot: true,
          link: null,
          register: { net: 10_000, sales: 4 },
          stats: { net: 10_120, sales: 5 },
          differs: true,
        },
      ],
      notes: [{ kind: 'bot_not_linked_to_agent', platformChatterId: 'c-bot' }],
    });
    page(ok(off));
    const panel = await screen.findByRole('region', { name: 'Vérification de fiabilité' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Vérifier ces jours' }));
    expect(await within(panel).findByText('Des chiffres ne concordent pas')).toBeTruthy();
    expect(within(panel).getByText('1 jour en écart')).toBeTruthy();
    expect(within(panel).getByText(/^Statistiques : net 101,20\s€ \(\+1,20\s€\)$/u)).toBeTruthy();
    expect(
      within(panel).getByText(
        'Le compte bot « Bot Agence » n’est pas relié à l’agent : ses ventes ne compteraient pour personne. Relie-le dans « Équipe Reveal ».',
      ),
    ).toBeTruthy();
    const team = within(panel).getByRole('region', { name: 'Par membre de l’équipe Reveal' });
    expect(within(team).getByText('Relié à personne')).toBeTruthy();
    expect(within(team).getByText('5 ventes')).toBeTruthy();
  });

  it('sends the export as text, read as Windows-1252 when it is not UTF-8, and lets it be taken off', async () => {
    const fetch = page(
      ok(report({ verdict: 'match', total: { ...report().total, export: totals(10_000) } })),
    );
    const panel = await screen.findByRole('region', { name: 'Vérification de fiabilité' });
    // « Revenu modèle » saved by a French spreadsheet: è is the single byte 0xE8.
    const bytes = new Uint8Array([
      ...new TextEncoder().encode('Date;Mod'),
      0xe8,
      ...new TextEncoder().encode('le;Net\n2026-10-20;lune;100,00\n'),
    ]);
    const file = new File([bytes], 'ventes.csv', { type: 'text/csv' });
    fireEvent.change(within(panel).getByLabelText(/Export du dashboard/u), { target: { files: [file] } });
    expect(await within(panel).findByText('ventes.csv · 2 lignes')).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Vérifier ces jours' }));
    await within(panel).findByText('Les chiffres concordent au centime');
    expect(checkBody(fetch)).toEqual({
      from: '2026-10-16',
      to: '2026-10-31',
      export: 'Date;Modèle;Net\n2026-10-20;lune;100,00\n',
    });
    fireEvent.click(within(panel).getByRole('button', { name: 'Retirer le fichier' }));
    expect(within(panel).queryByText('ventes.csv · 2 lignes')).toBeNull();
  });

  it('refuses today before asking: the day still moves', async () => {
    const fetch = page(ok(report()));
    const panel = await screen.findByRole('region', { name: 'Vérification de fiabilité' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Autres jours' }));
    fireEvent.change(within(panel).getByLabelText('Au'), { target: { value: '2026-11-03' } });
    expect(
      within(panel).getByText('Choisis des jours déjà terminés : la journée en cours bouge encore.'),
    ).toBeTruthy();
    expect(within(panel).getByRole('button', { name: 'Vérifier ces jours' })).toHaveProperty(
      'disabled',
      true,
    );
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('says the platform’s refusal and the server’s sentence for an export it cannot read', async () => {
    let answer: { status: number; body: unknown } = {
      status: 502,
      body: { kind: 'unreachable', message: 'Reveal ne répond pas pour l’instant.' },
    };
    page(() => answer);
    const panel = await screen.findByRole('region', { name: 'Vérification de fiabilité' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Vérifier ces jours' }));
    expect(
      await within(panel).findByText('La vérification n’a pas eu lieu. Reveal ne répond pas pour l’instant.'),
    ).toBeTruthy();

    answer = {
      status: 422,
      body: {
        error: {
          code: 'sales_feed_export_unprocessable',
          message: 'Export illisible : la colonne « net » manque',
          details: {},
          requestId: 'req-1',
        },
      },
    };
    fireEvent.click(within(panel).getByRole('button', { name: 'Vérifier ces jours' }));
    expect(
      await within(panel).findByText(
        'La vérification n’a pas eu lieu. Export illisible : la colonne « net » manque.',
      ),
    ).toBeTruthy();
  });

  it('shows the latest report kept on return, and that the switch can rest on it', async () => {
    const kept = report({
      generatedAt: '2026-11-03T06:00:00.000Z',
      registerReadAt: '2026-11-03T05:57:00.000Z',
      total: { ...report().total, export: totals(10_000) },
    });
    page(ok(report()), OVERVIEW, ok({ last: { report: kept, clean: true, checkedBy: 'u-owner' } }));
    const panel = await screen.findByRole('region', { name: 'Vérification de fiabilité' });
    expect(await within(panel).findByText('Les chiffres concordent au centime')).toBeTruthy();
    expect(
      within(panel).getByText(/^Vérifié il y a 3 h · du 16 au 31 octobre.* registre lu 3 min avant$/u),
    ).toBeTruthy();
    expect(
      within(panel).getByText(
        'Une quinzaine entière, et tout concorde : la bascule du compte pourra s’appuyer sur ce rapport.',
      ),
    ).toBeTruthy();
  });

  it('reads back, after a check, whether the switch can rest on it: not on days short of a fortnight', async () => {
    const day = report({
      from: '2026-10-20',
      to: '2026-10-20',
      total: { ...report().total, export: totals(10_000) },
    });
    let kept: unknown = { last: null };
    const fetch = page(
      () => {
        kept = { last: { report: day, clean: false, checkedBy: 'u-owner' } };
        return { status: 200, body: day };
      },
      OVERVIEW,
      () => ({ status: 200, body: kept }),
    );
    const panel = await screen.findByRole('region', { name: 'Vérification de fiabilité' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Autres jours' }));
    fireEvent.change(within(panel).getByLabelText('Du'), { target: { value: '2026-10-20' } });
    fireEvent.change(within(panel).getByLabelText('Au'), { target: { value: '2026-10-20' } });
    expect(within(panel).getByText(/La bascule du compte demandera une quinzaine entière\./u)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'Vérifier ces jours' }));
    expect(await within(panel).findByText(/mais pas sur une quinzaine entière/u)).toBeTruthy();
    expect(
      fetch.mock.calls.filter(([url, init]) => url === `${BASE}/reveal/check` && init?.method === undefined),
    ).toHaveLength(2);
  });

  it('is not offered while reading has stopped: the statistics need the key', async () => {
    const stopped = status({ state: 'needs_reconnect', lastErrorKind: 'unauthorized', message: 'Arrêtée.' });
    page(ok(report()), { ...OVERVIEW, status: stopped });
    await screen.findByText('Arrêtée.');
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Vérification de fiabilité' })).toBeNull();
    });
  });
});
