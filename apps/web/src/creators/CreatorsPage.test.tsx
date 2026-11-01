// @vitest-environment jsdom
import type { Me } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import blocksYaml from '../../../../personas/demo/v0.2.0.yaml?raw';
import { createAppRouter, type AppRouter } from '../router';

import { parsePersonaYaml } from './persona/source';

/* Invented creators and members: no real data. */
const ANNA = { id: '0192f3a0-0000-7000-8000-0000000000a1', displayName: 'Anna', timezone: 'Europe/Paris' };
const BEA = { id: '0192f3a0-0000-7000-8000-0000000000b2', displayName: 'Bea', timezone: 'Europe/Paris' };
const CLEO = { id: '0192f3a0-0000-7000-8000-0000000000c3', displayName: 'Cleo', timezone: 'Europe/Paris' };
const base = { id: 'u1', email: 'membre@example.test', name: 'Nora', creatorIds: [], routedCreatorIds: [] };
const owner: Me = { ...base, role: 'owner', team: null, teamScope: 'owner' };
/** An operator without a team row: the rail that still opens Créatrices, read-only. */
const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };

const summary = (n: number) => ({
  id: `0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4${String(n)}`,
  version: '0.2.0',
  contentHash: String(n).repeat(64),
  isActive: true,
  createdAt: '2026-10-28T08:00:00.000Z',
});

/** The creators the list answers (`null`: the list fails), each with the demo persona as her stored one. */
async function serve(creators: readonly (typeof ANNA)[] | null): Promise<void> {
  const persona = await parsePersonaYaml(blocksYaml);
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      // A creation answers the new creator, whatever was typed: the page only needs her summary.
      if (url === '/v1/creators' && init?.method === 'POST') return json(CLEO, 201);
      if (url === '/v1/creators') return creators === null ? json({}, 500) : json({ creators });
      const index = (creators ?? []).findIndex((c) => url === `/v1/creators/${c.id}/persona`);
      const creator = creators?.[index];
      if (creator !== undefined) {
        const latest = { summary: summary(index), persona };
        return json({ creatorId: creator.id, latest, versions: [summary(index)] });
      }
      return json({}, 404);
    }),
  );
}

function renderAt(user: Me, path: string): AppRouter {
  const router = createAppRouter(
    { user, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const chip = (name: string): HTMLElement => screen.getByRole('radio', { name });

/** The creator on screen: her chip is the one checked; no eyebrow repeats it over the header's views (CREA-24, NAV-10). */
const picked = (name: string): Promise<void> =>
  waitFor(() => {
    expect(chip(name).getAttribute('aria-checked')).toBe('true');
    const views = screen.getByRole('navigation', { name: 'Fiche de la créatrice' });
    expect(within(views).getByRole('link', { name: 'Persona' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByText(`${name} · Persona`)).toBeNull();
  });

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  Element.prototype.scrollIntoView = vi.fn();
  // The shell of a member measures its rail; jsdom has no layout.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices, the creator in the address (recette 28/10)', () => {
  it('opens the creator the address names, and writes the one picked into it', async () => {
    await serve([ANNA, BEA]);
    const router = renderAt(owner, `/creatrices?creatrice=${BEA.id}`);
    await picked('Bea');
    expect(chip('Bea').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(chip('Anna'));
    await picked('Anna');
    expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
  });

  it('asks before dropping changes not saved, and stays when told to', async () => {
    await serve([ANNA, BEA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const name = await screen.findByLabelText('Prénom');
    fireEvent.change(name, { target: { value: 'Elenaa' } });

    fireEvent.click(chip('Bea'));
    await screen.findByText('Tes modifications ne sont pas enregistrées.');
    fireEvent.click(screen.getByRole('button', { name: 'Rester' }));
    await waitFor(() => {
      expect(screen.queryByText('Tes modifications ne sont pas enregistrées.')).toBeNull();
    });
    expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    expect(screen.getByLabelText('Prénom')).toHaveProperty('value', 'Elenaa');

    // « Ajouter une créatrice » asks too, then « Les abandonner » lets the navigation through.
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une créatrice' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Rester' }));
    fireEvent.click(chip('Bea'));
    fireEvent.click(await screen.findByRole('button', { name: 'Les abandonner' }));
    await picked('Bea');
    expect(router.state.location.search).toEqual({ creatrice: BEA.id });
  });

  it('takes the owner to Réglages › Alertes inside the app, asking first when changes wait (CREA-25)', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    fireEvent.change(await screen.findByLabelText('Prénom'), { target: { value: 'Elenaa' } });
    expect(screen.getByText(/à changer dans Heures d’activité/u)).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: /Notifications/u }));
    fireEvent.click(await screen.findByRole('link', { name: 'Réglages › Alertes' }));
    await screen.findByText('Tes modifications ne sont pas enregistrées.');
    fireEvent.click(screen.getByRole('button', { name: 'Les abandonner' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/reglages/alertes');
    });
  });

  it('asks once on « Ajouter une créatrice », never again once the new creator is created', async () => {
    await serve([ANNA, BEA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    fireEvent.change(await screen.findByLabelText('Prénom'), { target: { value: 'Elenaa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une créatrice' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Les abandonner' }));

    fireEvent.change(await screen.findByLabelText('Prénom ou pseudo'), { target: { value: 'Cleo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => {
      expect(screen.queryByLabelText('Prénom ou pseudo')).toBeNull();
    });
    expect(screen.queryByText('Tes modifications ne sont pas enregistrées.')).toBeNull();
    expect(router.state.location.search).toEqual({ creatrice: CLEO.id });
  });
});

describe('Créatrices, what a member without the list reads', () => {
  it('tells a member that no creator is entrusted to him, instead of the example', async () => {
    await serve([]);
    renderAt(operator, '/creatrices');
    expect(await screen.findByText('Aucune créatrice ne t’est confiée')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Enregistrer une version' })).toBeNull();
  });

  it('tells the owner, before the form, where her first creator leads (CREA-28)', async () => {
    await serve([]);
    renderAt(owner, '/creatrices');
    expect(
      await screen.findByText('Commence par ta première créatrice : son nom, puis sa persona juste après.'),
    ).toBeDefined();
    expect(screen.getByLabelText('Prénom ou pseudo')).toBeDefined();
  });

  it('says the list does not load, with a way to try again', async () => {
    await serve(null);
    renderAt(owner, '/creatrices');
    expect(await screen.findByText('La liste des créatrices ne se charge pas')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });
});
