// @vitest-environment jsdom
import { type Me, type PersonaV2 } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import demoYaml from '../../../../personas/demo/v0.3.0.yaml?raw';
import { createAppRouter, type AppRouter } from '../router';

import { parsePersonaYaml } from './persona/source';
import { viewOf } from './scripts/prepared/fixtures';

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
  preferences: { sounds: true },
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
        return json({
          today: '2026-11-03',
          current: null,
          rates: [],
          observed: {
            linked: false,
            last30Days: { from: '2026-10-05', to: '2026-11-03', shares: [] },
            fortnights: [],
          },
          alerts: [],
        });
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
    // Her sheets on the header's row of tabs, never among its buttons (recette visuelle 16/11, T1).
    expect(views.closest('.nv-page__tabs')).not.toBeNull();
    expect(views.closest('.nv-page__actions')).toBeNull();
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
    // Her AI's switch on her card (ADR 0148 § 1): the state in words, and the owner's gestures.
    expect(within(anna).getByText('IA active · Copilote')).toBeDefined();
    expect(within(anna).getByRole('button', { name: 'Pause' })).toBeDefined();
    expect(within(anna).getByRole('button', { name: 'Couper' })).toBeDefined();
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
      expect(within(anna).getByText('IA active · Automatique')).toBeDefined();
    });
    // A scope of one's own reads the state and never changes it (ADR 0148 § 1).
    expect(within(anna).queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(within(anna).queryByRole('button', { name: 'Couper' })).toBeNull();
    expect(within(anna).queryByText('Chiffre d’affaires')).toBeNull();
    expect(within(anna).queryByText('En poste')).toBeNull();
    expect(within(anna).queryByText('Contenu attendu')).toBeNull();
    expect(within(anna).getByText('Rien')).toBeDefined();
    expect(within(anna).queryByText('Mise en route')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Ajouter une créatrice' })).toBeNull();
    fireEvent.click(within(anna).getByRole('link', { name: 'Anna' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    });
  });

  it('gives the owner her Accès, a card of Compte in the address, and keeps it from anyone else (CR-02)', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const views = await screen.findByRole('navigation', { name: 'Fiche de la créatrice' });
    fireEvent.click(within(views).getByRole('link', { name: 'Compte' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'compte', creatrice: ANNA.id });
    });
    // Her account: the list answers 404 here, so the card says the server is silent, never a form to fill.
    await waitFor(() => {
      expect(document.getElementById('acces')?.textContent).toContain('Le serveur ne répond pas');
    });
    // The address of before the seven tabs lands on the same card (ADR 0149 § 5).
    router.history.push(`/creatrices?onglet=acces&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'compte', creatrice: ANNA.id });
    });
    expect(router.state.location.hash).toBe('acces');

    cleanup();
    await serve([ANNA]);
    const other = renderAt(operator, `/creatrices?onglet=acces&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(other.state.location.search).toEqual({ creatrice: ANNA.id });
    });
    // A sheet asked by name and refused says why, as any page that is not his (recette visuelle 16/11, PIL-26).
    expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();

    // No sheet asked: his first one, without a word.
    cleanup();
    await serve([ANNA]);
    const plain = renderAt(operator, `/creatrices?creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(plain.state.location.search).toEqual({ creatrice: ANNA.id });
    });
    await screen.findByRole('heading', { level: 1, name: 'Anna' });
    expect(screen.queryByText('Cette page n’est pas dans ton espace.')).toBeNull();
  });

  it('gives the owner her Profil, where her name is changed, and keeps it from anyone else (ADR 0071)', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const views = await screen.findByRole('navigation', { name: 'Fiche de la créatrice' });
    fireEvent.click(within(views).getByRole('link', { name: 'Compte' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'compte', creatrice: ANNA.id });
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
  it('opens as a card of Compte, the creator kept in the address', async () => {
    await serve([ANNA, BEA]);
    const router = renderAt(owner, `/creatrices?creatrice=${BEA.id}`);
    await picked('Bea');
    const views = screen.getByRole('navigation', { name: 'Fiche de la créatrice' });
    fireEvent.click(within(views).getByRole('link', { name: 'Compte' }));
    expect(
      await screen.findByText('À régler : relie Reveal ou règle un pourcentage pour Bea.'),
    ).toBeDefined();
    expect(router.state.location.search).toEqual({ onglet: 'compte', creatrice: BEA.id });
    expect(within(views).getByRole('link', { name: 'Compte' }).getAttribute('aria-current')).toBe('page');
    // One page, a card per subject, in this order (ADR 0149 § 1).
    expect([...document.querySelectorAll('.cr-account__card')].map((card) => card.id)).toEqual([
      'acces',
      'part',
      'profil',
      'telegram',
    ]);
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
  it('is the fifth of her seven tabs, the creator kept in the address (ADR 0149 § 1)', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?creatrice=${ANNA.id}`);
    const views = await screen.findByRole('navigation', { name: 'Fiche de la créatrice' });
    const names = within(views)
      .getAllByRole('link')
      .map((link) => link.textContent);
    expect(names).toEqual(['Persona', 'IA', 'Médias', 'Scripts', 'Agenda', 'Alertes', 'Compte']);
    fireEvent.click(within(views).getByRole('link', { name: 'Agenda' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'agenda', creatrice: ANNA.id });
    });
    // The suggestions answer 404 here: the sheet says the server is silent, and still offers to propose.
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    expect(screen.getByRole('button', { name: 'Proposer une tâche' })).toBeDefined();
    // Her ideas of the day and what the agency asks of her are views of the tab: one segmented selector, in the
    // address, never a second bar of tabs (ADR 0149 § 3).
    const selector = screen.getByRole('radiogroup', { name: 'Vue de son agenda' });
    expect(
      within(selector)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Agenda', 'Idées du jour', 'Demandes']);
    fireEvent.click(within(selector).getByRole('radio', { name: 'Idées du jour' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'agenda', vue: 'idees', creatrice: ANNA.id });
    });
    expect(await screen.findByText('Ses idées du jour')).toBeDefined();
    expect(within(views).getByRole('link', { name: 'Agenda' }).getAttribute('aria-current')).toBe('page');
  });

  it('opens on Médias for an active manager, with Scripts and Agenda; the other tabs the owner’s', async () => {
    await serve([ANNA]);
    const router = renderAt(manager, `/creatrices?creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'medias', creatrice: ANNA.id });
    });
    const sheets = await screen.findByRole('navigation', { name: 'Fiche de la créatrice' });
    expect(
      within(sheets)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Persona', 'Médias', 'Scripts', 'Agenda']);
    // Her persona to read (trou béant 18): named in the address, since no tab sends a manager to Médias.
    expect(within(sheets).getByRole('link', { name: 'Persona' }).getAttribute('href')).toContain(
      'onglet=persona',
    );
    expect(
      within(screen.getByRole('radiogroup', { name: 'Vue de ses médias' }))
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Coffre Reveal', 'Dépôts', 'Coffre Impera']);
    // Structures and her made-to-measure prices are the owner's; a manager reads her custom orders under « Sur mesure ».
    router.history.push(`/creatrices?onglet=scripts&creatrice=${ANNA.id}`);
    expect(
      within(await screen.findByRole('radiogroup', { name: 'Vue de ses scripts' }))
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Scripts', 'À copier', 'Sur mesure']);
    router.history.push(`/creatrices?onglet=scripts&vue=a-copier&creatrice=${ANNA.id}`);
    await screen.findByText('Scripts envoyés par Anna');
    // The addresses of before the seven tabs lead to their view (ADR 0149 § 5).
    router.history.push(`/creatrices?onglet=idees&creatrice=${ANNA.id}`);
    expect(await screen.findByText('Ses idées du jour')).toBeDefined();
    expect(router.state.location.search).toEqual({ onglet: 'agenda', vue: 'idees', creatrice: ANNA.id });
    router.history.push(`/creatrices?onglet=contenu&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'medias', vue: 'depots', creatrice: ANNA.id });
    });
    for (const onglet of ['pourcentage', 'acces', 'heures', 'alertes']) {
      router.history.push(`/creatrices?onglet=${onglet}&creatrice=${ANNA.id}`);
      await waitFor(() => {
        expect(router.state.location.search).toEqual({ onglet: 'medias', creatrice: ANNA.id });
      });
    }
  });

  it('sends her links to Trafic, the creator kept', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?onglet=liens&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/trafic');
    });
    expect(router.state.location.search).toEqual({ creatrice: ANNA.id });
    expect(await screen.findByRole('heading', { level: 1, name: 'Trafic' })).toBeDefined();
  });

  it('lets an active manager read her persona, never change it (trou béant 18)', async () => {
    await serve([ANNA]);
    const router = renderAt(manager, `/creatrices?onglet=persona&creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'persona', creatrice: ANNA.id });
    });
    expect(
      await screen.findByText('Lecture seule : seuls le propriétaire et la créatrice modifient sa persona.'),
    ).toBeDefined();
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

describe('her sheet in seven tabs, and Trafic (ADR 0149)', () => {
  it('shows the agency’s structures as a view of Scripts, to the owner', async () => {
    await serve([ANNA]);
    const router = renderAt(owner, `/creatrices?onglet=scripts&creatrice=${ANNA.id}`);
    const selector = await screen.findByRole('radiogroup', { name: 'Vue de ses scripts' });
    expect(
      within(selector)
        .getAllByRole('radio')
        .map((radio) => radio.textContent),
    ).toEqual(['Scripts', 'À copier', 'Structures', 'Sur mesure']);
    fireEvent.click(within(selector).getByRole('radio', { name: 'Structures' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({
        onglet: 'scripts',
        vue: 'structures',
        creatrice: ANNA.id,
      });
    });
    // Inside her sheet: her name stays the page's title, no page nor header of the structures' own. The library
    // answers 404 here, so the view says the server is silent.
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    expect(screen.getByRole('heading', { level: 1, name: 'Anna' })).toBeDefined();
    expect(screen.queryByRole('heading', { level: 1, name: 'Structures de script' })).toBeNull();
  });

  it('opens in « Scripts » a script picked in « À copier dans Reveal », and forgets it once « Scripts » is left', async () => {
    await serve([ANNA]);
    const served = vi.mocked(fetch).getMockImplementation();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) =>
        url === `/v1/creators/${ANNA.id}/prepared-scripts`
          ? Promise.resolve(
              new Response(JSON.stringify([viewOf({ state: 'ready_to_copy' })]), { status: 200 }),
            )
          : (served?.(url, init) ?? Promise.resolve(new Response('{}', { status: 404 }))),
      ),
    );
    const router = renderAt(owner, `/creatrices?onglet=scripts&vue=a-copier&creatrice=${ANNA.id}`);
    // The selector counts what waits to be copied.
    expect(await screen.findByRole('radio', { name: 'À copier · 1' })).toBeDefined();
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir le script' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'scripts', creatrice: ANNA.id });
    });
    // The editor, with its way back to the list.
    expect(await screen.findByRole('button', { name: /Ses scripts/u })).toBeDefined();
    // Another tab, then « Scripts » again: the list, not that script.
    router.history.push(`/creatrices?onglet=agenda&creatrice=${ANNA.id}`);
    await screen.findByText('Son agenda');
    router.history.push(`/creatrices?onglet=scripts&creatrice=${ANNA.id}`);
    expect(await screen.findByRole('button', { name: /Nouveau script/u })).toBeDefined();
  });

  it('reopens her sheet from the menu on the tab left open last on this device', async () => {
    localStorage.clear();
    await serve([ANNA]);
    renderAt(owner, `/creatrices?onglet=agenda&vue=idees&creatrice=${ANNA.id}`);
    await screen.findByText('Ses idées du jour');
    const menu = await waitFor(() => {
      const link = document.querySelector('.nv-rail__item[data-section="/creatrices"]');
      expect(link?.getAttribute('href')).toContain('onglet=agenda');
      return link;
    });
    // The tab, not the view inside it: it opens on its first one.
    expect(menu?.getAttribute('href')).not.toContain('vue=');
    expect(menu?.getAttribute('href')).toContain(ANNA.id);
  });

  it('gives Trafic to the owner and to an active manager, who reads her links, and to nobody else', async () => {
    await serve([ANNA]);
    renderAt(manager, `/trafic?creatrice=${ANNA.id}`);
    expect(await screen.findByRole('heading', { level: 1, name: 'Trafic' })).toBeDefined();
    expect(screen.getByRole('region', { name: 'Liens' })).toBeDefined();

    cleanup();
    await serve([ANNA]);
    const other = renderAt(chatter, `/trafic?creatrice=${ANNA.id}`);
    await waitFor(() => {
      expect(other.state.location.pathname).toBe('/aujourdhui');
    });
  });
});

describe('Créatrices, what a member without the list reads', () => {
  it('tells a member that no creator is entrusted to him, instead of the example', async () => {
    await serve([]);
    renderAt(operator, '/creatrices');
    expect(await screen.findByText('Aucune créatrice ne t’est confiée')).toBeDefined();
    // The whole screen is empty: its drawing stands above the sentence.
    expect(document.querySelector('.nv-empty__art svg')).not.toBeNull();
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
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });
});

describe('her persona, in her Moi (CR-02, ADR 0042 § 8)', () => {
  it('opens her Moi on her profile, her persona one tab away, never in Créatrices, and keeps a member’s Moi screens from her', async () => {
    await serve([ANNA]);
    const router = renderAt(anna, '/moi');
    // A short profile first (recette visuelle 16/11, CRE-03): who she is in Impera, and where the rest is.
    expect(await screen.findByRole('heading', { level: 1, name: 'Profil' })).toBeDefined();
    expect(router.state.location.pathname).toBe('/moi/profil');
    expect(await screen.findByText('Dans Impera')).toBeDefined();
    const moi = screen.getByRole('navigation', { name: 'Moi' });
    expect(
      within(moi)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Profil', 'Persona', 'Mes liens', 'Trophées', 'Sécurité', 'Aide', 'Préférences']);
    cleanup();

    await serve([ANNA]);
    renderAt(anna, '/moi/persona');
    expect(await screen.findByRole('heading', { level: 1, name: 'Persona' })).toBeDefined();
    // She reads her sheet; the agency changes it (recette CREA-01).
    await screen.findByText(/^Ta fiche, panneau par panneau/);
    expect(screen.queryByRole('button', { name: 'Enregistrer une version' })).toBeNull();
    cleanup();

    for (const path of ['/moi/dossier', '/moi/calendrier', '/moi/factures']) {
      await serve([ANNA]);
      const again = renderAt(anna, path);
      await waitFor(() => {
        expect(again.state.location.pathname).toBe('/moi/profil');
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

describe('Créatrices, her « Mise en route » (pilotage plan W1)', () => {
  const step = (key: string, state: 'done' | 'todo' | 'waiting', note: unknown = null) => ({
    key,
    state,
    note,
  });
  const ALL_DONE = [
    'platform_account',
    'persona',
    'agency_rate',
    'access',
    'pay_rules',
    'telegram',
    'agent_hours',
    'shifts',
    'agent_mode',
    'reliability_check',
  ].map((key) => step(key, 'done'));

  /** `serve`, with her « Mise en route » answered as given. */
  async function serveSetup(steps: readonly unknown[]): Promise<void> {
    await serve([ANNA]);
    const inner = vi.mocked(fetch);
    const answered = inner.getMockImplementation();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
        if (url === '/v1/dashboard/setup/creators')
          return json({ creators: [{ creatorId: ANNA.id, steps }] });
        if (answered === undefined) throw new Error('serve() answers first');
        return answered(url, init);
      }),
    );
  }

  it('says on her card how far she is, her next step opening where it is done', async () => {
    await serveSetup(
      ALL_DONE.map((one) =>
        one.key === 'agency_rate'
          ? step('agency_rate', 'todo')
          : one.key === 'access'
            ? step('access', 'waiting')
            : one,
      ),
    );
    const router = renderAt(owner, '/creatrices');
    const anna = await cardOf('Anna');
    await within(anna).findByText('Mise en route');
    expect(within(anna).getByText('8 sur 10')).toBeDefined();
    // What is to do comes before what waits on her.
    fireEvent.click(within(anna).getByRole('link', { name: 'Prochaine étape : La part de l’agence' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ onglet: 'compte', creatrice: ANNA.id });
    });
    // On the card of the page of Compte where it is done.
    expect(router.state.location.hash).toBe('part');
  });

  it('lays out every step on her sheet, the next one first', async () => {
    await serveSetup(
      ALL_DONE.map((one) =>
        one.key === 'pay_rules'
          ? step('pay_rules', 'todo', { kind: 'accounts', done: 1, total: 2 })
          : one.key === 'agent_hours'
            ? step('agent_hours', 'done', { kind: 'default_hours' })
            : one,
      ),
    );
    renderAt(owner, `/creatrices?onglet=pourcentage&creatrice=${ANNA.id}`);
    const card = await screen.findByRole('region', { name: 'Mise en route de la créatrice' });
    expect(within(card).getByText('9 sur 10')).toBeDefined();
    expect(within(card).getByText('Les règles de paie de ses comptes')).toBeDefined();
    expect(
      within(card).getByRole('link', { name: 'Régler : Les règles de paie de ses comptes' }),
    ).toBeDefined();
    expect(
      within(card).getByText('1 compte sur 2 · Sans elles, les rapports de fin de shift sont refusés.'),
    ).toBeDefined();
    fireEvent.click(within(card).getByRole('button', { name: 'Tout voir' }));
    fireEvent.click(within(card).getByRole('button', { name: 'Voir les 9 étapes faites' }));
    expect(within(card).getByText('Heures par défaut de l’agence.')).toBeDefined();
    expect(within(card).getAllByRole('listitem')).toHaveLength(10);
  });

  it('is gone once all is done, and never asked for anyone but the owner', async () => {
    await serveSetup(ALL_DONE);
    renderAt(owner, '/creatrices');
    await cardOf('Anna');
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/v1/dashboard/setup/creators')).toBe(true);
    });
    expect(screen.queryByText('Mise en route')).toBeNull();
    cleanup();

    await serveSetup(ALL_DONE.map((one) => ({ ...one, state: 'todo' })));
    renderAt(operator, '/creatrices');
    await cardOf('Anna');
    expect(screen.queryByText('Mise en route')).toBeNull();
    expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/v1/dashboard/setup/creators')).toBe(false);
  });
});
