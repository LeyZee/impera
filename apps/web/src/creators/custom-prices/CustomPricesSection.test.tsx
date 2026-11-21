// @vitest-environment jsdom
import {
  CreatorIdSchema,
  emptyCustomPriceGrid,
  SaveCustomPriceGridBodySchema,
  type CustomPriceGridView,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CustomPricesSection } from './CustomPricesSection';

/* An invented creator and neutral test prices: never the agency's own (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `/v1/creators/:id/custom-prices` that keeps what it is sent; `conflict` answers the next PUT with a 409. */
function serve(options: { conflict?: boolean } = {}): unknown[] {
  const puts: unknown[] = [];
  let view: CustomPriceGridView = {
    creatorId: CREATOR,
    version: 0,
    grid: emptyCustomPriceGrid(),
    updatedAt: null,
  };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/v1/creators/${CREATOR}/custom-prices`);
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method !== 'PUT') return json(view);
      const body = SaveCustomPriceGridBodySchema.parse(
        JSON.parse(typeof init.body === 'string' ? init.body : 'null'),
      );
      puts.push(body);
      if (options.conflict === true) return json(apiError('custom_prices_version_conflict'), 409);
      view = {
        ...view,
        version: body.baseVersion + 1,
        grid: body.grid,
        updatedAt: '2026-11-20T14:53:00.000Z',
      };
      return json(view);
    }),
  );
  return puts;
}

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({
    component: (): JSX.Element => <CustomPricesSection creatorId={CREATOR} creatorName="Anna" />,
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

const row = (name: string): HTMLElement => {
  const item = screen.getByText(name, { selector: '.smp-row__label' }).closest('li');
  if (item === null) throw new Error(`no row ${name}`);
  return item;
};
const typeIn = (within_: HTMLElement, label: string, value: string): void => {
  fireEvent.change(within(within_).getByLabelText(label), { target: { value } });
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Sur mesure (ADR 0159 § C)', () => {
  it('opens on the empty grid, never saved, with every line and no price', async () => {
    serve();
    renderSection();
    expect(await screen.findByText('Jamais enregistrée : remplis les prix, puis enregistre.')).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Prix sur mesure de Anna' })).toBeDefined();
    expect(within(row('Vidéo pour lui')).getByLabelText('Prix')).toHaveProperty('value', '');
    expect(within(row('Appel')).getByLabelText('Prix à la minute')).toBeDefined();
    expect(screen.getByText(/^Aucun supplément pour l’instant/u)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Enregistrer' })).toBeNull();
  });

  it('prices an order in the calculator as the code will, then saves the grid on the version read', async () => {
    const puts = serve();
    renderSection();
    await screen.findByText(/^Jamais enregistrée/u);
    typeIn(row('Vidéo pour lui'), 'Prix', '100');
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un supplément/u }));
    fireEvent.change(screen.getByLabelText('Nom du supplément'), { target: { value: 'Test A' } });
    fireEvent.change(screen.getByLabelText('Majoration'), { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test A', pressed: false }));
    const result = screen.getByText('Prix proposé').closest('div');
    if (result === null) throw new Error('no result');
    expect(within(result).getByText('150 €')).toBeDefined();
    expect(within(result).getByText('Test A +50 %')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(puts).toHaveLength(1);
    });
    expect(puts[0]).toMatchObject({ baseVersion: 0 });
    expect(await screen.findByText(/^Enregistrée le /u)).toBeDefined();
  });

  it('says « Jamais » and declines in the calculator what she never does', async () => {
    serve();
    renderSection();
    await screen.findByText(/^Jamais enregistrée/u);
    fireEvent.click(within(row('Visio sexuelle')).getByRole('switch'));
    expect(within(row('Visio sexuelle')).getByText('L’IA décline sans lui demander.')).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: 'Visio sexuelle' }));
    expect(
      screen.getByText('Elle ne le fait pas (Visio sexuelle) : l’IA déclinera sans lui demander.'),
    ).toBeDefined();
  });

  it('adds a supplement he names, which needs a name before saving', async () => {
    serve();
    renderSection();
    await screen.findByText(/^Jamais enregistrée/u);
    fireEvent.click(screen.getByRole('button', { name: /Ajouter un supplément/u }));
    expect(screen.getByText('Donne-lui un nom.')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true);
    fireEvent.change(screen.getByLabelText('Nom du supplément'), { target: { value: 'Supplément de test' } });
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', false);
  });

  it('says when another save came first, and offers to reload', async () => {
    serve({ conflict: true });
    renderSection();
    await screen.findByText(/^Jamais enregistrée/u);
    typeIn(row('Photo pour lui'), 'Prix', '20');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/enregistrée ailleurs entre-temps/u)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Recharger la grille' })).toBeDefined();
  });
});
