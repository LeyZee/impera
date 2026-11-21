// @vitest-environment jsdom
import {
  CreateCreatorAgencyRateBodySchema,
  CreatorIdSchema,
  type CreatorAgencyRateList,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgencyRateSection } from './AgencyRateSection';

const confirmIdentity = vi.fn<(password: string, code: string) => Promise<string>>();
vi.mock('@/settings/services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/settings/services/api')>()),
  confirmIdentity: (password: string, code: string) => confirmIdentity(password, code),
}));

/* An invented creator and percentages: never the agency's own. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const TODAY = '2026-11-03';

interface Rate {
  readonly id: string;
  readonly creatorId: string;
  readonly fromDay: string;
  readonly agencyBps: number;
  readonly createdAt: string;
}

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/**
 * A fake `/v1/creators/:id/agency-rates` that keeps what it is sent, as the server would: the one in force is the
 * latest day at or before today. `refuse` answers a POST with that status and code instead.
 */
const NOTHING_READ: CreatorAgencyRateList['observed'] = {
  linked: false,
  last30Days: { from: '2026-10-05', to: TODAY, shares: [] },
  fortnights: [],
};

interface Refusal {
  readonly status: number;
  readonly code: string;
}

function serve(
  rates: Rate[],
  refuse?: Refusal | (() => Refusal | undefined),
  observed: object = NOTHING_READ,
  alerts: unknown[] = [],
): unknown[] {
  const posts: unknown[] = [];
  const list = () => {
    const sorted = rates.toSorted((a, b) => b.fromDay.localeCompare(a.fromDay));
    return {
      today: TODAY,
      current: sorted.find((one) => one.fromDay <= TODAY) ?? null,
      rates: sorted,
      observed,
      alerts,
    };
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/v1/creators/${CREATOR}/agency-rates`);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method !== 'POST') return json(list());
      const body = CreateCreatorAgencyRateBodySchema.parse(
        JSON.parse(typeof init.body === 'string' ? init.body : 'null'),
      );
      posts.push(body);
      const refusal = typeof refuse === 'function' ? refuse() : refuse;
      if (refusal !== undefined) return json(apiError(refusal.code), refusal.status);
      const stored = { ...body, creatorId: CREATOR, createdAt: '2026-11-03T10:00:00.000Z' };
      rates.push(stored);
      return json(stored, 201);
    }),
  );
  return posts;
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // A router of its own: the card links to Réglages › Plateformes to link Reveal.
  const root = createRootRoute({
    component: (): JSX.Element => <AgencyRateSection creatorId={CREATOR} creatorName="Anna" />,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/creatrices'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Pourcentage (CR-04)', () => {
  it('says « À régler » while she has none, and lets her first start today', async () => {
    serve([]);
    renderSection();
    expect(
      await screen.findByText('À régler : relie Reveal ou règle un pourcentage pour Anna.'),
    ).toBeDefined();
    // Typed, never the system's calendar: a day before today is refused in words.
    type('À partir du', '2/11/2026');
    expect(screen.getByText(/^Le .* au plus tôt\.$/u)).toBeDefined();
    type('À partir du', TODAY);
    expect(screen.queryByText(/au plus tôt\.$/u)).toBeNull();
    expect(screen.queryByText('Historique')).toBeNull();
    // Nothing linked: nothing is read, and the card says where to link Reveal.
    const read = screen.getByRole('region', { name: 'Lue chez Reveal' });
    expect(within(read).getByText(/^Aucun compte Reveal relié : aucune part lue\./u)).toBeDefined();
    expect(within(read).getByRole('link', { name: 'Relier Reveal' }).getAttribute('href')).toBe(
      '/reglages/ventes',
    );
  });

  it('has the owner read the whole sentence before saving, then shows it in force', async () => {
    const posts = serve([]);
    renderSection();
    await screen.findByText(/^À régler/u);
    const check = screen.getByRole('button', { name: 'Vérifier avant d’enregistrer' });
    expect(check).toHaveProperty('disabled', true);
    type('Pourcentage de l’agence', '35');
    type('À partir du', TODAY);
    fireEvent.click(check);
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm.textContent).toContain('35\u00a0% pour l’agence à partir du 3 novembre 2026.');
    expect(confirm.textContent).toContain(
      'Il ne pourra plus être modifié, seulement remplacé par un suivant.',
    );
    expect(posts).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Enregistrer' }));
    expect(
      // The matcher reads the page's non-breaking spaces as plain ones.
      await screen.findByText('35 % pour l’agence aujourd’hui, depuis le 3 novembre 2026.'),
    ).toBeDefined();
    expect(posts).toMatchObject([{ fromDay: TODAY, agencyBps: 3500 }]);
    const history = screen.getByRole('list');
    expect(within(history).getByText('En vigueur')).toBeDefined();
    // The next one starts tomorrow at the earliest.
    type('À partir du', TODAY);
    expect(await screen.findByText('Le 4 novembre 2026 au plus tôt.')).toBeDefined();
  });

  it('asks the owner for the password and the code when the confirmation is old, then saves the same percentage (EQ-15)', async () => {
    let fresh = false;
    const posts = serve([], () => (fresh ? undefined : { status: 403, code: 'reauthentication_forbidden' }));
    confirmIdentity.mockImplementation(() => {
      fresh = true;
      return Promise.resolve('ok');
    });
    renderSection();
    await screen.findByText(/^À régler/u);
    type('Pourcentage de l’agence', '35');
    type('À partir du', TODAY);
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier avant d’enregistrer' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Enregistrer' }),
    );
    // Never « Seul le compte propriétaire… »: the owner is asked again, nothing written meanwhile.
    expect(
      await screen.findByText('Ce geste touche à l’argent : confirme ton mot de passe et ton code.'),
    ).toBeDefined();
    expect(screen.queryByText(/^Seul le compte propriétaire/u)).toBeNull();
    // What is sent again is what was read: the percentage and the day are locked meanwhile.
    expect(screen.getByLabelText('Pourcentage de l’agence')).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('À partir du')).toHaveProperty('disabled', true);
    // The same prompt as in the dialogs: « Confirmer » is the one neon.
    expect(screen.getByRole('button', { name: 'Confirmer' }).className).toContain('nv-btn--neon');
    type('Mot de passe', 'mot-de-passe-invente');
    type('Code à 6 chiffres ou de secours', '123456');
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(
      await screen.findByText('35 % pour l’agence aujourd’hui, depuis le 3 novembre 2026.'),
    ).toBeDefined();
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
  });

  it('turns « Revenir » into nothing sent, and a refused day into its sentence', async () => {
    const current = {
      id: '0192f3a0-0000-7000-8000-0000000000e1',
      creatorId: CREATOR,
      fromDay: '2026-11-01',
      agencyBps: 3500,
      createdAt: '2026-11-01T10:00:00.000Z',
    };
    const posts = serve([current], { status: 409, code: 'agency_rate_day_conflict' });
    renderSection();
    await screen.findByText('35 % pour l’agence aujourd’hui, depuis le 1er novembre 2026.');
    type('Pourcentage de l’agence', '30,5');
    type('À partir du', '2026-11-20');
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier avant d’enregistrer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Revenir' }));
    expect(posts).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Vérifier avant d’enregistrer' }));
    fireEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Enregistrer' }),
    );
    expect(
      await screen.findByText(
        'Elle a déjà un pourcentage à partir de ce jour. Choisis un autre jour : rien n’a été enregistré.',
      ),
    ).toBeDefined();
    expect(posts).toMatchObject([{ fromDay: '2026-11-20', agencyBps: 3050 }]);
  });

  it('holds back a percentage that is not one, and a day before the earliest', async () => {
    serve([
      {
        id: '0192f3a0-0000-7000-8000-0000000000e1',
        creatorId: CREATOR,
        fromDay: '2026-11-01',
        agencyBps: 3500,
        createdAt: '2026-11-01T10:00:00.000Z',
      },
    ]);
    renderSection();
    await screen.findByText(/pour l’agence aujourd’hui/u);
    type('Pourcentage de l’agence', '101');
    expect(screen.getByText('Un pourcentage de 0 à 100, comme 35 ou 35,5.')).toBeDefined();
    type('Pourcentage de l’agence', '30');
    type('À partir du', TODAY);
    expect(screen.getByText('Le 4 novembre 2026 au plus tôt.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Vérifier avant d’enregistrer' })).toHaveProperty(
      'disabled',
      true,
    );
  });

  it('shows the agency’s share read at Reveal first, the percentage optional (ADR 0054 § 4 and § 6)', async () => {
    const share = {
      platform: 'reveal',
      platformAccountId: '0192f3a0-0000-7000-8000-0000000000a1',
      currency: 'EUR',
      netMinor: 1800,
      agencyMinor: 700,
      agencyBps: 3889,
      differsFromRate: null,
    };
    serve([], undefined, {
      linked: true,
      last30Days: { from: '2026-10-05', to: TODAY, shares: [share] },
      fortnights: [
        { from: '2026-11-01', to: TODAY, shares: [share] },
        { from: '2026-10-16', to: '2026-10-31', shares: [] },
        { from: '2026-10-01', to: '2026-10-15', shares: [] },
      ],
    });
    renderSection();
    expect(
      await screen.findByText(
        /^Lue chez Reveal : 38,89\s% du net sur 30 jours\. Le pourcentage est facultatif\.$/u,
      ),
    ).toBeDefined();
    expect(screen.queryByText(/^À régler/u)).toBeNull();
    const read = screen.getByRole('region', { name: 'Lue chez Reveal' });
    expect(within(read).getAllByText(/^38,89\s% du net$/u)).toHaveLength(2);
    expect(within(read).getAllByText(/^7,00\s€ pour l’agence sur 18,00\s€ nets$/u)).toHaveLength(2);
    expect(within(read).getByText('du 16 au 31 octobre')).toBeDefined();
    expect(within(read).getAllByText('aucune vente')).toHaveLength(2);
    expect(screen.getByText('Son pourcentage, facultatif')).toBeDefined();
    // Her one account in euros: the card's title names Reveal, no line repeats it.
    expect(within(read).queryByText('Reveal')).toBeNull();
  });

  it('keeps the share read first when a percentage is set, and is not « à régler » for a linked account without a sale', async () => {
    serve(
      [
        {
          id: '0192f3a0-0000-7000-8000-0000000000f1',
          creatorId: CREATOR,
          fromDay: '2026-10-01',
          agencyBps: 3500,
          createdAt: '2026-10-01T08:00:00.000Z',
        },
      ],
      undefined,
      { ...NOTHING_READ, linked: true },
    );
    renderSection();
    expect(
      await screen.findByText(
        /^Aucune vente lue chez Reveal sur 30 jours\. Pourcentage réglé : 35\s% depuis le 1er octobre 2026\.$/u,
      ),
    ).toBeDefined();
    expect(screen.getByText('Nouveau pourcentage, facultatif')).toBeDefined();
  });

  it('warns in amber when the share read differs from her percentage (V-PIL-25)', async () => {
    const share = {
      platform: 'reveal',
      platformAccountId: '0192f3a0-0000-7000-8000-0000000000a1',
      currency: 'EUR',
      netMinor: 1_462_240,
      agencyMinor: 548_344,
      agencyBps: 3750,
      differsFromRate: true,
    };
    serve(
      [
        {
          id: '0192f3a0-0000-7000-8000-0000000000f1',
          creatorId: CREATOR,
          fromDay: '2026-10-01',
          agencyBps: 4000,
          createdAt: '2026-10-01T08:00:00.000Z',
        },
      ],
      undefined,
      {
        linked: true,
        last30Days: { from: '2026-10-05', to: TODAY, shares: [share] },
        fortnights: [{ from: '2026-11-01', to: TODAY, shares: [share] }],
      },
    );
    renderSection();
    expect(
      await screen.findByText(/^Écart : Reveal donne 37,5\s% du net sur 30 jours, tu as réglé 40\s%\./u),
    ).toBeDefined();
    expect(document.querySelector('.ps-dot')?.getAttribute('data-dot')).toBe('warn');
    const read = screen.getByRole('region', { name: 'Lue chez Reveal' });
    expect(within(read).getAllByText(/^écart avec les 40\s% réglés$/u)).toHaveLength(2);
  });

  it('lists the alerts the automatic check published, in amber, above the shares read (PAY-04)', async () => {
    serve([], undefined, { ...NOTHING_READ, linked: true }, [
      {
        id: '0192f3a0-0000-7000-8000-0000000000f3',
        kind: 'changed',
        at: '2026-11-02T05:30:00.000Z',
        from: '2026-10-16',
        to: '2026-10-31',
        platform: 'reveal',
        platformAccountId: '0192f3a0-0000-7000-8000-0000000000a1',
        currency: 'EUR',
        previousAgencyBps: 3333,
        agencyBps: 3750,
      },
    ]);
    renderSection();
    const alerts = await screen.findByRole('region', { name: 'Alertes envoyées' });
    expect(
      within(alerts).getByText(
        /^Alerte du 2 novembre, quinzaine du 16 au 31 octobre : la part de l’agence est passée de 33,33\s% à 37,5\s%\.$/u,
      ),
    ).toBeDefined();
    expect(alerts.querySelector('.ps-dot')?.getAttribute('data-dot')).toBe('warn');
  });

  it('shows the three newest alerts, the others behind « Voir les précédentes »', async () => {
    const alert = (n: number) => ({
      id: `0192f3a0-0000-7000-8000-00000000001${String(n)}`,
      kind: 'mismatch',
      at: '2026-11-02T05:30:00.000Z',
      from: '2026-10-16',
      to: '2026-10-31',
      platform: 'reveal',
      platformAccountId: '0192f3a0-0000-7000-8000-0000000000a1',
      currency: 'EUR',
    });
    serve([], undefined, { ...NOTHING_READ, linked: true }, [alert(1), alert(2), alert(3), alert(4)]);
    renderSection();
    const alerts = await screen.findByRole('region', { name: 'Alertes envoyées' });
    expect(within(alerts).getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(within(alerts).getByRole('button', { name: 'Voir les précédentes' }));
    expect(within(alerts).getAllByRole('listitem')).toHaveLength(4);
    expect(within(alerts).queryByRole('button', { name: 'Voir les précédentes' })).toBeNull();
  });

  it('shows no alert line while the automatic check published none', async () => {
    serve([], undefined, { ...NOTHING_READ, linked: true });
    renderSection();
    expect(await screen.findByText(/^Aucune vente lue chez Reveal sur 30 jours\./u)).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Alertes envoyées' })).toBeNull();
  });

  it('says the server does not answer, with a way to try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response(null, { status: 500 }))),
    );
    renderSection();
    expect(await screen.findByText('Son pourcentage ne se charge pas')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
    });
  });
});
