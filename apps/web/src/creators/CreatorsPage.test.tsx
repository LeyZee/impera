// @vitest-environment jsdom
import { type Me, type PersonaV2 } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import demoYaml from '../../../../personas/demo/v0.3.0.yaml?raw';
import { createAppRouter, type AppRouter } from '../router';

import { parsePersonaYaml } from './persona/source';

/** A version stored at format 2: the draft is the version itself, nothing moved (ADR 0079 § 5). */
const asDraft = (persona: PersonaV2) => ({ draft: persona, moved: [] });

/* Invented creators and members: no real data. */
const ANNA = { id: '0192f3a0-0000-7000-8000-0000000000a1', displayName: 'Anna', timezone: 'Europe/Paris' };
const BEA = { id: '0192f3a0-0000-7000-8000-0000000000b2', displayName: 'Bea', timezone: 'Europe/Paris' };
const CLEO = { id: '0192f3a0-0000-7000-8000-0000000000c3', displayName: 'Cleo', timezone: 'Europe/Paris' };
const base = {
  id: 'u1',
  email: 'membre@example.test',
  name: 'Nora',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
};
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

/** A card of the list as the owner reads it; Anna's says her fortnight, who is on shift and what she owes. */
const card = (creator: typeof ANNA) =>
  creator.id === ANNA.id
    ? {
        creatorId: creator.id,
        mode: 'copilot',
        sales: {
          from: '2026-11-16',
          to: '2026-11-20',
          sales: 4,
          refunds: 0,
          revenueMinor: 184_650,
          usdLeftOut: false,
        },
        onShift: [
          {
            memberId: '0192f3a0-0000-7000-8000-0000000000d4',
            name: 'Théo',
            endsAt: '2026-11-20T22:00:00.000Z',
          },
        ],
        requests: { open: 2, next: { category: 'feed_video', dueOn: '2000-01-05', late: true } },
      }
    : { creatorId: creator.id, mode: 'stop', sales: null, onShift: [], requests: { open: 0, next: null } };

/** The creators the list answers (`null`: the list fails), each with the demo persona as her stored one. */
async function serve(creators: readonly (typeof ANNA)[] | null): Promise<void> {
  const persona = await parsePersonaYaml(demoYaml);
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      // A creation answers the new creator, whatever was typed: the page only needs her summary.
      if (url === '/v1/creators' && init?.method === 'POST') return json(CLEO, 201);
      if (url === '/v1/creators') return creators === null ? json({}, 500) : json({ creators });
      // The cards of the list (« ok liste-créatrices »): Anna on Copilote with her fortnight, the others on Arrêt.
      if (url === '/v1/dashboard/creators') return json({ creators: (creators ?? []).map(card) });
      if (url === '/v1/dashboard/todos') {
        return json({
          items: [],
          creators: (creators ?? []).map((c, i) => ({
            creatorId: c.id,
            name: c.displayName,
            todos: i === 0 ? 3 : 0,
            grave: i === 0 ? 1 : 0,
          })),
        });
      }
      const index = (creators ?? []).findIndex((c) => url === `/v1/creators/${c.id}/persona`);
      const creator = creators?.[index];
      if (creator !== undefined) {
        const latest = { summary: summary(index), persona, ...asDraft(persona) };
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

/** Her sheet on screen, on her persona: her name is the page's title, the list one step back. */
const picked = (name: string): Promise<void> =>
  waitFor(() => {
    expect(screen.getByRole('heading', { level: 1, name })).toBeDefined();
    expect(screen.getByRole('link', { name: '← Créatrices' })).toBeDefined();
    const views = screen.getByRole('navigation', { name: 'Fiche de la créatrice' });
    expect(within(views).getByRole('link', { name: 'Persona' }).getAttribute('aria-current')).toBe('page');
  });

/** The card of a creator in the list. */
const cardOf = async (name: string): Promise<HTMLElement> => {
  const link = await screen.findByRole('link', { name });
  const item = link.closest('li');
  if (item === null) throw new Error(`no card for ${name}`);
  return item;
};

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
  it('opens on the list, even with one creator, and a card opens her sheet, « ← Créatrices » going back', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, '/creatrices');
    const anna = await cardOf('Anna');
    expect(screen.getByRole('heading', { level: 1, name: 'Créatrices' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Ajouter une créatrice' })).toBeDefined();
    expect(screen.queryByRole('navigation', { name: 'Fiche de la créatrice' })).toBeNull();
    await waitFor(() => {
      expect(within(anna).getByText('1 846,50 €')).toBeDefined();
    });
    expect(within(anna).getByText('Copilote')).toBeDefined();
    expect(within(anna).getByText('du 16 au 20 nov.')).toBeDefined();
    expect(within(anna).getByText(/^Théo jusqu’à/u)).toBeDefined();
    expect(within(anna).getByText('🎬 Feed · Vidéo short')).toBeDefined();
    expect(within(anna).getByText(/^En retard depuis .* · 1 autre attendu$/u)).toBeDefined();
    expect(within(anna).getByText('3, dont 1 urgent')).toBeDefined();

    fireEvent.click(within(anna).getByRole('link', { name: 'Anna' }));
    await picked('Anna');
    expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    // On her sheet, nothing of the list: neither the other creators nor « Ajouter une créatrice ».
    expect(screen.queryByRole('button', { name: 'Ajouter une créatrice' })).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: '← Créatrices' }));
    await cardOf('Anna');
    expect(router.state.location.search).toEqual({});
  });

  it('opens the creator the address names, and the list for one it does not hold', async () => {
    await serve([ANNA, BEA]);
    renderAt(owner, `/creatrices?creatrice=${BEA.id}`);
    await picked('Bea');
    cleanup();
    await serve([ANNA, BEA]);
    renderAt(owner, `/creatrices?creatrice=${CLEO.id}`);
    await cardOf('Bea');
    expect(screen.getByRole('link', { name: 'Anna' })).toBeDefined();
  });

  it('says on a card only what the server gives: no figures for a reader whose scope is his own', async () => {
    await serve([ANNA]);
    vi.mocked(fetch).mockImplementation((url: string | URL | Request) => {
      const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      if (url === '/v1/creators') return json({ creators: [ANNA] });
      if (url === '/v1/dashboard/creators') {
        return json({
          creators: [{ creatorId: ANNA.id, mode: 'auto', sales: null, onShift: null, requests: null }],
        });
      }
      if (url === '/v1/dashboard/todos') return json({ items: [], creators: [] });
      return json({});
    });
    const router = renderAt(operator, '/creatrices');
    const anna = await cardOf('Anna');
    await waitFor(() => {
      expect(within(anna).getByText('Automatique')).toBeDefined();
    });
    expect(within(anna).queryByText('Chiffre d’affaires')).toBeNull();
    expect(within(anna).queryByText('En poste')).toBeNull();
    expect(within(anna).queryByText('Contenu attendu')).toBeNull();
    expect(within(anna).getByText('Rien')).toBeDefined();
    expect(within(anna).queryByText('À configurer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter une créatrice' })).toBeNull();
    fireEvent.click(within(anna).getByRole('link', { name: 'Anna' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    });
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
    const name = await screen.findByLabelText('Surnom');
    fireEvent.change(name, { target: { value: 'Elenaa' } });

    fireEvent.click(screen.getByRole('link', { name: '← Créatrices' }));
    await screen.findByText('Tes modifications ne sont pas enregistrées.');
    fireEvent.click(screen.getByRole('button', { name: 'Rester' }));
    await waitFor(() => {
      expect(screen.queryByText('Tes modifications ne sont pas enregistrées.')).toBeNull();
    });
    expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    expect(screen.getByLabelText('Surnom')).toHaveProperty('value', 'Elenaa');

    // « Les abandonner » lets the navigation through, back to the list.
    fireEvent.click(screen.getByRole('link', { name: '← Créatrices' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Les abandonner' }));
    await cardOf('Bea');
    expect(router.state.location.search).toEqual({});
  });

  it('takes the owner to Réglages › Alertes inside the app, asking first when changes wait (CREA-25)', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    fireEvent.change(await screen.findByLabelText('Surnom'), { target: { value: 'Elenaa' } });
    expect(screen.getByText(/à changer dans Heures d’activité/u)).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: /Réglages de l’agent/u }));
    fireEvent.click(await screen.findByRole('link', { name: 'Réglages › Alertes' }));
    await screen.findByText('Tes modifications ne sont pas enregistrées.');
    fireEvent.click(screen.getByRole('button', { name: 'Les abandonner' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/reglages/alertes');
    });
  });

  it('adds a creator from the list, her sheet opening once she is created, « Annuler » back to the list', async () => {
    await serve([ANNA, BEA]);
    const router = renderAt(owner, '/creatrices');
    await cardOf('Anna');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une créatrice' }));
    await screen.findByLabelText('Prénom ou pseudo');
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    await cardOf('Anna');

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une créatrice' }));
    fireEvent.change(await screen.findByLabelText('Prénom ou pseudo'), { target: { value: 'Cleo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ creatrice: CLEO.id });
    });
    expect(screen.queryByLabelText('Prénom ou pseudo')).toBeNull();
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

  it('opens on her agenda for an active manager, beside her ideas; the persona and the other sheets the owner’s', async () => {
    await serve([ANNA]);
    const router = renderAt(manager, `/creatrices?creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'agenda', creatrice: ANNA.id });
    });
    expect(await screen.findByRole('button', { name: 'Proposer une tâche' })).toBeDefined();
    const sheets = screen.getByRole('navigation', { name: 'Fiche de la créatrice' });
    expect(
      within(sheets)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Agenda', 'Idées du jour', 'Demandes', 'Scripts', 'Contenu']);
    router.history.push(`/creatrices?onglet=idees&creatrice=${ANNA.id}`);
    expect(await screen.findByText('Ses idées du jour')).toBeDefined();
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

    for (const path of ['/moi/profil', '/moi/dossier', '/moi/calendrier', '/moi/factures']) {
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

  it('sends a member who opens it to his own profile', async () => {
    await serve([ANNA]);
    const router = renderAt(chatter, '/moi/persona');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/moi/profil');
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

  it('says on her card what is left to the owner, each step opening its tab', async () => {
    await serveSetup(null, null);
    const router = renderAt(owner, '/creatrices');
    const anna = await cardOf('Anna');
    await within(anna).findByText('À configurer');
    // Her persona is stored: only her percentage and her access are left.
    expect(
      within(anna)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Anna', 'Pourcentage', 'Accès']);
    fireEvent.click(within(anna).getByRole('link', { name: 'Pourcentage' }));
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
    renderAt(owner, '/creatrices');
    await cardOf('Anna');
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url]) => url === `/v1/creators/${ANNA.id}/account`)).toBe(
        true,
      );
    });
    expect(screen.queryByText('À configurer')).toBeNull();
    cleanup();

    await serveSetup(null, null);
    renderAt(operator, '/creatrices');
    await cardOf('Anna');
    expect(screen.queryByText('À configurer')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === `/v1/creators/${ANNA.id}/account`)).toBe(
      false,
    );
  });
});
