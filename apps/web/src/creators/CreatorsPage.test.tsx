// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
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
/** Anna herself, in her own space (ADR 0042). */
const anna: Me = { ...base, role: 'creator', creatorIds: [ANNA.id], team: null, teamScope: 'self' };
/** An active manager: Créatrices opens on her agenda alone (Charles, 05/11 17h22). */
const manager: Me = {
  ...base,
  role: 'operator',
  team: { role: 'manager', status: 'active' },
  teamScope: 'agency',
};
const chatter: Me = {
  ...base,
  role: 'operator',
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};

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
      // Her agency percentage (CR-04): none set yet.
      if ((creators ?? []).some((c) => url === `/v1/creators/${c.id}/agency-rates`)) {
        return json({ today: '2026-11-03', current: null, rates: [] });
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

  it('gives the owner her Accès, in the address, and keeps it from anyone else (CR-02)', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const views = await screen.findByRole('navigation', { name: 'Fiche de la créatrice' });
    fireEvent.click(within(views).getByRole('link', { name: 'Accès' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'acces', creatrice: ANNA.id });
    });
    // Her account: the list answers 404 here, so the sheet says it does not load, never a form to fill.
    expect(await screen.findByText('Son accès ne se charge pas')).toBeDefined();

    cleanup();
    await serve([ANNA]);
    const other = renderAt(operator, `/creatrices?onglet=acces&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(other.state.location.search).toEqual({ creatrice: ANNA.id });
    });
  });

  it('gives the owner her Profil, where her name is changed, and keeps it from anyone else (ADR 0071)', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const views = await screen.findByRole('navigation', { name: 'Fiche de la créatrice' });
    fireEvent.click(within(views).getByRole('link', { name: 'Profil' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'profil', creatrice: ANNA.id });
    });
    expect(await screen.findByText('Nom : Anna')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Renommer' })).toBeDefined();

    cleanup();
    await serve([ANNA]);
    const other = renderAt(operator, `/creatrices?onglet=profil&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(other.state.location.search).toEqual({ creatrice: ANNA.id });
    });
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

describe('Créatrices › Pourcentage, the owner’s alone (CR-04)', () => {
  it('opens from its tab in the header, the creator kept in the address', async () => {
    await serve([ANNA, BEA]);
    const router = renderAt(owner, `/creatrices?creatrice=${BEA.id}`);
    await picked('Bea');
    const views = screen.getByRole('navigation', { name: 'Fiche de la créatrice' });
    fireEvent.click(within(views).getByRole('link', { name: 'Pourcentage' }));
    expect(
      await screen.findByText(
        'À régler : aucun pourcentage pour Bea, aucune part de l’agence n’est montrée.',
      ),
    ).toBeDefined();
    expect(router.state.location.search).toEqual({ onglet: 'pourcentage', creatrice: BEA.id });
    expect(within(views).getByRole('link', { name: 'Pourcentage' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });

  it('takes anyone else back to the persona, never to a page the server would refuse', async () => {
    await serve([ANNA]);
    const router = renderAt(operator, `/creatrices?onglet=pourcentage&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    });
    expect(screen.queryByText(/^À régler/u)).toBeNull();
  });
});

describe('Créatrices › Agenda, the owner’s and an active manager’s (CR-05 lot c)', () => {
  it('opens right after the persona, the creator kept in the address', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const views = await screen.findByRole('navigation', { name: 'Fiche de la créatrice' });
    const names = within(views)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names.slice(0, 2)).toEqual(['Persona', 'Agenda']);
    fireEvent.click(within(views).getByRole('link', { name: 'Agenda' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'agenda', creatrice: ANNA.id });
    });
    // The suggestions answer 404 here: the sheet says they do not load, and still offers to propose.
    expect(await screen.findByText('Ses propositions ne se chargent pas')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Proposer une tâche' })).toBeDefined();
  });

  it('opens on her agenda alone for an active manager, the persona and the other sheets the owner’s', async () => {
    await serve([ANNA]);
    const router = renderAt(manager, `/creatrices?creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'agenda', creatrice: ANNA.id });
    });
    expect(await screen.findByRole('button', { name: 'Proposer une tâche' })).toBeDefined();
    expect(screen.queryByRole('navigation', { name: 'Fiche de la créatrice' })).toBeNull();
    for (const onglet of ['pourcentage', 'acces', 'heures']) {
      router.history.push(`/creatrices?onglet=${onglet}&creatrice=${ANNA.id}`);
      await waitFor(() => {
        expect(router.state.location.search).toEqual({ onglet: 'agenda', creatrice: ANNA.id });
      });
    }
  });

  it('takes an operator who is not an active manager back to the persona', async () => {
    await serve([ANNA]);
    const router = renderAt(operator, `/creatrices?onglet=agenda&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    });
    expect(screen.queryByText('Son agenda')).toBeNull();
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

describe('her persona, in her Moi (CR-02, ADR 0042 § 8)', () => {
  it('opens her persona in Moi, never Créatrices, and keeps a member’s Moi screens from her', async () => {
    await serve([ANNA]);
    const router = renderAt(anna, '/moi');
    expect(await screen.findByRole('heading', { level: 1, name: 'Persona' })).toBeDefined();
    expect(router.state.location.pathname).toBe('/moi/persona');
    const moi = screen.getByRole('navigation', { name: 'Moi' });
    expect(
      within(moi)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Persona', 'Sécurité', 'Préférences']);
    // She reads her sheet; the agency changes it (recette CREA-01).
    await screen.findByText(/Ta fiche/);
    expect(screen.queryByRole('button', { name: 'Enregistrer une version' })).toBeNull();
    cleanup();

    for (const path of ['/moi/dossier', '/moi/calendrier', '/moi/factures']) {
      await serve([ANNA]);
      const again = renderAt(anna, path);
      await waitFor(() => {
        expect(again.state.location.pathname).toBe('/moi/persona');
      });
      cleanup();
    }

    await serve([ANNA]);
    const away = renderAt(anna, `/creatrices?creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(away.state.location.pathname).toBe('/aujourdhui');
    });
  });

  it('sends a member who opens it to his own file', async () => {
    await serve([ANNA]);
    const router = renderAt(chatter, '/moi/persona');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/moi/dossier');
    });
  });
});

describe('Créatrices, what is left to set up for her (CRM-07 b2)', () => {
  /** `serve`, with her account and her percentage answered as given. */
  async function serveSetup(account: unknown, current: unknown): Promise<void> {
    await serve([ANNA]);
    const inner = vi.mocked(fetch);
    const answered = inner.getMockImplementation();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
        if (url === `/v1/creators/${ANNA.id}/account`) return json({ account });
        if (url === `/v1/creators/${ANNA.id}/agency-rates`)
          return json({ today: '2026-11-05', current, rates: current === null ? [] : [current] });
        if (answered === undefined) throw new Error('serve() answers first');
        return answered(url, init);
      }),
    );
  }

  it('says to the owner what is left, each step opening its tab, her zone beside it', async () => {
    await serveSetup(null, null);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const card = await screen.findByRole('region', { name: 'Pour démarrer avec Anna' });
    expect(within(card).getByText('1 sur 3')).toBeDefined();
    expect(within(card).getAllByRole('listitem')[0]?.textContent).toBe('Sa persona : fait');
    expect(within(card).getByText('À créer : son lien d’invitation.')).toBeDefined();
    expect(within(card).getByText(/Ses heures se lisent à l’heure de Paris/u)).toBeDefined();
    fireEvent.click(within(card).getByRole('link', { name: 'Ouvrir : Le pourcentage de l’agence' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'pourcentage', creatrice: ANNA.id });
    });
  });

  it('is gone once all is done, and never shown to anyone but the owner', async () => {
    const rate = {
      id: '0192f3a0-0000-7000-8000-0000000000f1',
      creatorId: ANNA.id,
      fromDay: '2026-11-01',
      agencyBps: 4000,
      createdAt: '2026-11-01T08:00:00.000Z',
    };
    await serveSetup(
      { email: 'anna@example.test', invitationPending: false, invitationExpiresAt: null },
      rate,
    );
    renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    await screen.findByRole('heading', { name: 'Créatrices' });
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url]) => url === `/v1/creators/${ANNA.id}/account`)).toBe(
        true,
      );
    });
    expect(screen.queryByRole('region', { name: /Pour démarrer/u })).toBeNull();
    cleanup();

    await serveSetup(null, null);
    renderAt(operator, `/creatrices?creatrice=${ANNA.id}`);
    await screen.findByRole('heading', { name: 'Créatrices' });
    expect(screen.queryByRole('region', { name: /Pour démarrer/u })).toBeNull();
  });
});
