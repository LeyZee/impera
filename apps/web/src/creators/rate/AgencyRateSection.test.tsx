// @vitest-environment jsdom
import { CreateCreatorAgencyRateBodySchema } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgencyRateSection } from './AgencyRateSection';

/* An invented creator and percentages: never the agency's own. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
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
function serve(rates: Rate[], refuse?: { status: number; code: string }): unknown[] {
  const posts: unknown[] = [];
  const list = () => {
    const sorted = rates.toSorted((a, b) => b.fromDay.localeCompare(a.fromDay));
    return { today: TODAY, current: sorted.find((one) => one.fromDay <= TODAY) ?? null, rates: sorted };
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
      if (refuse !== undefined) return json(apiError(refuse.code), refuse.status);
      const stored = { ...body, creatorId: CREATOR, createdAt: '2026-11-03T10:00:00.000Z' };
      rates.push(stored);
      return json(stored, 201);
    }),
  );
  return posts;
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgencyRateSection creatorId={CREATOR} creatorName="Anna" />
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
      await screen.findByText(
        'À régler : aucun pourcentage pour Anna, aucune part de l’agence n’est montrée.',
      ),
    ).toBeDefined();
    expect(screen.getByLabelText('À partir du').getAttribute('min')).toBe(TODAY);
    expect(screen.queryByText('Historique')).toBeNull();
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
    expect(confirm.textContent).toContain('35\u00a0% pour l’agence à partir du 03/11/2026.');
    expect(confirm.textContent).toContain(
      'Il ne pourra plus être modifié, seulement remplacé par un suivant.',
    );
    expect(posts).toEqual([]);
    fireEvent.click(within(confirm).getByRole('button', { name: 'Enregistrer' }));
    expect(
      // The matcher reads the page's non-breaking spaces as plain ones.
      await screen.findByText('35 % pour l’agence aujourd’hui, depuis le 03/11/2026.'),
    ).toBeDefined();
    expect(posts).toMatchObject([{ fromDay: TODAY, agencyBps: 3500 }]);
    const history = screen.getByRole('list');
    expect(within(history).getByText('En vigueur')).toBeDefined();
    // The next one starts tomorrow at the earliest.
    expect(screen.getByLabelText('À partir du').getAttribute('min')).toBe('2026-11-04');
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
    await screen.findByText('35 % pour l’agence aujourd’hui, depuis le 01/11/2026.');
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
    expect(screen.getByText('Le 04/11/2026 au plus tôt.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Vérifier avant d’enregistrer' })).toHaveProperty(
      'disabled',
      true,
    );
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
