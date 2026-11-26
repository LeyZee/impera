// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createAppRouter, type AppRouter } from '../router';

import { RailNav } from './AppShell';
import type { NavItem, Rail } from './nav';

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

beforeEach(() => {
  // The router restores the scroll on each navigation; jsdom has no layout to scroll.
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom has no matchMedia: a reduced motion, so the lens and the icons do not play.
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  // The screens stay on their loading state: only the shell is under test.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderApp(user: Me, path: string): AppRouter {
  const router = createAppRouter(
    { user, onSignOut: () => undefined },
    createMemoryHistory({ initialEntries: [path] }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const tabs = (): string[] =>
  [
    ...screen
      .getByRole('navigation', { name: 'Navigation' })
      .querySelectorAll('.nv-rail__item:not(.nv-rail__more)'),
  ].map((tab) => tab.getAttribute('title') ?? '');

describe('the rail of each role', () => {
  it('plays the icon of a tab on every click, the one already open too (Charles, 21/11)', async () => {
    // Motion allowed here: the suite's default (no matchMedia in jsdom) is a reduced motion, where nothing plays.
    vi.stubGlobal('matchMedia', () => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    renderApp(owner, '/');
    await screen.findByText('Chatting');
    const tab = screen.getByRole('navigation', { name: 'Navigation' }).querySelector('[data-section="/"]');
    const icon = tab?.querySelector('svg');
    expect(icon?.classList.contains('is-playing')).toBe(false);
    if (tab !== null) fireEvent.click(tab);
    expect(icon?.classList.contains('is-playing')).toBe(true);
  });

  it('gives the owner his tabs in the order of ADR 0024, under Chatting and Agence', async () => {
    renderApp(owner, '/');
    await screen.findByText('Chatting');
    expect(tabs()).toEqual([
      'Dashboard',
      'Suivi',
      'Entraîner',
      'Créatrices',
      'Équipe',
      'Paie',
      'Trafic',
      'Réglages',
    ]);
    expect(screen.getByText('Agence')).toBeDefined();
    // Eight places: the phone keeps four on its bar and folds the rest under « Plus ».
    expect(screen.getByRole('button', { name: 'Plus' })).toBeDefined();
    expect(screen.getByText('Propriétaire')).toBeDefined();
  });

  it('gives the owner and a manager « Flou des médias » over Réglages, never a creator or a chatter (SC-04 lot c4)', async () => {
    renderApp(owner, '/');
    await screen.findByText('Chatting');
    const rail = screen.getByRole('navigation', { name: 'Navigation' });
    expect(within(rail).getByRole('switch', { name: 'Flou des médias' })).toBeDefined();
    cleanup();
    renderApp({ ...base, role: 'creator', team: null, teamScope: 'self', creatorIds: ['c1'] }, '/');
    await screen.findByRole('navigation', { name: 'Navigation' });
    expect(screen.queryByRole('switch', { name: 'Flou des médias' })).toBeNull();
    cleanup();
    renderApp(
      { ...base, role: 'operator', team: { role: 'chatter', status: 'active' }, teamScope: 'self' },
      '/',
    );
    await screen.findByRole('navigation', { name: 'Navigation' });
    expect(screen.queryByRole('switch', { name: 'Flou des médias' })).toBeNull();
  });

  it('opens Équipe on its Planning, Membres a tab away', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    const router = renderApp(owner, '/equipe');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/equipe/planning');
    });
    const sub = await screen.findByRole('navigation', { name: 'Équipe' });
    expect(within(sub).getByRole('link', { name: 'Membres' }).getAttribute('href')).toBe('/equipe/membres');
  });

  it('sends a chatter who opens Réglages back to his first tab, and shows him only his own', async () => {
    const router = renderApp(chatter, '/reglages');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aujourdhui');
    });
    expect(tabs()).toEqual(['Aujourd’hui', 'Suivi', 'Planning', 'Commissions', 'Moi']);
    expect(screen.getByText('Chatteur')).toBeDefined();
    // No Dashboard in his rail: no agent pill reading it either.
    expect(screen.queryByText('Agent')).toBeNull();
  });

  it('sends a chatter away from the Dashboard and from Entraîner too', async () => {
    const router = renderApp(chatter, '/entrainer/playground');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aujourdhui');
    });
    await router.navigate({ to: '/' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aujourdhui');
    });
    // Équipe is the agency's: its Planning is not his.
    await router.navigate({ to: '/equipe/planning' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aujourdhui');
    });
  });

  it('names a manager on leave a manager, though he has the chatter’s rail', async () => {
    renderApp({ ...manager, team: { role: 'manager', status: 'on_leave' }, teamScope: 'self' }, '/suivi');
    expect(await screen.findByText('Manager')).toBeDefined();
    expect(tabs()).toEqual(['Aujourd’hui', 'Suivi', 'Planning', 'Commissions', 'Moi']);
  });

  it('sends a creator who opens Suivi to her Aujourd’hui: she never sees a conversation', async () => {
    const router = renderApp(
      { ...base, role: 'creator', team: null, teamScope: 'self' },
      '/suivi?conversation=c1',
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aujourdhui');
    });
    // Her own space (ADR 0042 § 8), and no Réglages: every page of it is the owner's (NAV-18).
    expect(tabs()).toEqual(['Aujourd’hui', 'Agenda', 'Ventes', 'Contenu', 'Moi']);
    expect(screen.getByText('Créatrice')).toBeDefined();
  });

  it('keeps a manager out of Réglages, and opens him Entraîner without her channel’s posts (ADR 0092 § 8)', async () => {
    const router = renderApp(manager, '/reglages/modeles-ia');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(tabs()).toEqual([
      'Dashboard',
      'Suivi',
      'Entraîner',
      'Créatrices',
      'Équipe',
      'Paie',
      'Trafic',
      'Moi',
    ]);
    cleanup();
    const canal = renderApp(manager, '/entrainer/canal');
    await waitFor(() => {
      expect(canal.state.location.pathname).toBe('/entrainer/playground');
    });
  });
});

describe('Réglages › Sauvegardes', () => {
  const subTabs = async (): Promise<string[]> =>
    within(await screen.findByRole('navigation', { name: 'Réglages' }))
      .getAllByRole('link')
      .map((link) => link.textContent);

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('is a line of the owner, in the group Sécurité, after Alertes and before Sécurité (SEC-04)', async () => {
    const router = renderApp(owner, '/reglages/sauvegardes');
    expect(await subTabs()).toEqual([
      'Plateformes',
      'Bots Telegram',
      'Modèles IA',
      'Consommation IA',
      'Règles de paie',
      'Facturation',
      'Alertes',
      'Sauvegardes',
      'Sécurité',
      'Aide',
    ]);
    expect(router.state.location.pathname).toBe('/reglages/sauvegardes');
  });

  // Réglages is the owner's alone (NAV-18): any of its addresses sends anyone else to his first tab, and says why.
  it('sends an operator or a creator from any page of Réglages to the first tab, and says why (NAV-21)', async () => {
    for (const path of [
      '/reglages/ventes',
      '/reglages/sauvegardes',
      '/reglages/alertes',
      '/reglages/regles-de-paie',
      '/reglages/facturation',
      '/reglages/securite',
      '/reglages/apparence',
    ]) {
      for (const user of [
        { ...base, role: 'operator', team: null, teamScope: 'self' },
        { ...base, role: 'creator', team: null, teamScope: 'self' },
      ] satisfies Me[]) {
        const router = renderApp(user, path);
        await waitFor(() => {
          expect(router.state.location.pathname).toBe(user.role === 'creator' ? '/aujourdhui' : '/');
        });
        const said = await screen.findByText('Cette page n’est pas dans ton espace.');
        expect(said.closest('[role="status"]')).not.toBeNull();
        expect(screen.queryByRole('navigation', { name: 'Réglages' })).toBeNull();
        cleanup();
      }
    }
  });
});

describe('a page inside an open section that is not the account’s', () => {
  // A sub-page guard says it too, not only the root (recette Équipe 07/11, EQP-03): the page is someone else's, not
  // broken.
  it('sends to the section’s own page and says why', async () => {
    // Moi and Suivi carry a sub-nav, which watches its tabs' widths.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    const creator: Me = { ...base, role: 'creator', team: null, teamScope: 'self' };
    const cases: readonly (readonly [Me, string, string])[] = [
      [manager, '/creatrices/structures', '/creatrices'],
      [chatter, '/suivi/alertes', '/suivi'],
      [manager, '/moi/persona', '/moi/profil'],
      [creator, '/moi/dossier', '/moi/profil'],
    ];
    for (const [user, path, landing] of cases) {
      const router = renderApp(user, path);
      await waitFor(() => {
        expect(router.state.location.pathname, path).toBe(landing);
      });
      await waitFor(() => {
        expect(
          screen.queryByText('Cette page n’est pas dans ton espace.')?.closest('[role="status"]'),
          path,
        ).toBeTruthy();
      });
      cleanup();
    }
  });
});

describe('the guards of Comptes Reveal, Mes liens, Trophées and her script, through the real router', () => {
  const creator: Me = { ...base, role: 'creator', team: null, teamScope: 'self' };
  const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };
  const onLeave: Me = { ...manager, team: { role: 'manager', status: 'on_leave' }, teamScope: 'self' };

  beforeEach(() => {
    // Moi and Équipe carry a sub-nav, which watches its tabs' widths.
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  /** The account opens `path` and lands on `expected`, inside its own shell. */
  async function landing(user: Me, path: string, expected: string): Promise<void> {
    const router = renderApp(user, path);
    await waitFor(() => {
      expect(router.state.location.pathname, `${user.role} ${path}`).toBe(expected);
    });
    // A real screen of the account's own, never a dead end.
    expect(await screen.findByRole('navigation', { name: 'Navigation' })).toBeDefined();
  }

  it('opens Comptes Reveal to the owner and an active manager; anyone else lands on his first tab, told why', async () => {
    for (const user of [owner, manager]) {
      await landing(user, '/equipe/reveal', '/equipe/reveal');
      expect(await screen.findByRole('heading', { level: 1, name: 'Comptes Reveal' })).toBeDefined();
      cleanup();
    }
    // Équipe is not on their rail: the shell turns them away before the page's own guard is reached.
    for (const [user, home] of [
      [chatter, '/aujourdhui'],
      [onLeave, '/aujourdhui'],
      [operator, '/'],
      [creator, '/aujourdhui'],
    ] as const) {
      await landing(user, '/equipe/reveal', home);
      expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();
      cleanup();
    }
  });

  it('keeps Mes liens hers: a member of the team lands on his profile, an account without Moi on its first tab', async () => {
    await landing(creator, '/moi/liens', '/moi/liens');
    expect(await screen.findByRole('heading', { level: 1, name: 'Mes liens' })).toBeDefined();
    cleanup();
    for (const [user, home] of [
      [manager, '/moi/profil'],
      [chatter, '/moi/profil'],
      [owner, '/'],
      [operator, '/'],
    ] as const) {
      await landing(user, '/moi/liens', home);
      expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();
      cleanup();
    }
  });

  it('opens Trophées to a chatter and to her; a manager lands on his profile, told why', async () => {
    for (const user of [chatter, creator]) {
      await landing(user, '/moi/trophees', '/moi/trophees');
      expect(await screen.findByRole('heading', { level: 1, name: 'Trophées' })).toBeDefined();
      cleanup();
    }
    for (const [user, home] of [
      [manager, '/moi/profil'],
      [onLeave, '/moi/profil'],
      [owner, '/'],
    ] as const) {
      await landing(user, '/moi/trophees', home);
      expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();
      cleanup();
    }
  });

  it('sends her from a script address that names no drop back to Contenu, and keeps the team out of it', async () => {
    await landing(creator, '/contenu/script/pas-un-depot', '/contenu');
    expect(await screen.findByRole('heading', { level: 1, name: 'Contenu' })).toBeDefined();
    cleanup();
    for (const [user, home] of [
      [owner, '/'],
      [chatter, '/aujourdhui'],
    ] as const) {
      await landing(user, '/contenu/script/0192f3a0-0000-7000-8000-0000000000d1', home);
      expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();
      cleanup();
    }
  });
});

describe('« Plus » on the phone', () => {
  const item = (to: NavItem['to'], label: string, icon: NavItem['icon']): NavItem => ({
    to,
    label,
    icon,
    family: null,
  });
  const rail: Rail = {
    kind: 'owner',
    items: [
      item('/suivi', 'Suivi', 'tracking'),
      item('/entrainer', 'Entraîner', 'train'),
      item('/creatrices', 'Créatrices', 'creators'),
    ],
    settings: item('/reglages', 'Réglages', 'settings'),
    home: '/suivi',
    phoneMenu: true,
    headed: new Set(),
    more: new Set(['/entrainer', '/creatrices', '/reglages']),
  };

  function renderRail(path: string): void {
    const root = createRootRoute({
      component: (): JSX.Element => (
        <>
          <RailNav rail={rail} current={`/${path.split('/')[1] ?? ''}`} />
          <Outlet />
        </>
      ),
    });
    const routes = ['/suivi', '/entrainer', '/creatrices', '/reglages'].map((to) =>
      createRoute({ getParentRoute: () => root, path: to }),
    );
    const router = createRouter({
      routeTree: root.addChildren(routes),
      history: createMemoryHistory({ initialEntries: [path] }),
    });
    // The rail reads its counts (ADR 0134 § 8): a client of its own, as in the app.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it('lights up when the screen shown is one of its tabs', async () => {
    renderRail('/creatrices');
    const more = await screen.findByRole('button', { name: 'Plus' });
    expect(more.getAttribute('data-current')).toBe('true');
    expect(screen.getByTitle('Créatrices').getAttribute('data-phone')).toBe('more');
    expect(screen.getByTitle('Suivi').getAttribute('data-phone')).toBe('bar');
  });

  it('opens a modal sheet on the current tab, keeps Tab inside, and gives the focus back on Escape', async () => {
    renderRail('/creatrices');
    const more = await screen.findByRole('button', { name: 'Plus' });
    more.focus();
    fireEvent.click(more);
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const links = within(sheet).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Entraîner', 'Créatrices', 'Réglages']);
    expect(document.activeElement).toBe(within(sheet).getByRole('link', { current: 'page' }));

    links[2]?.focus();
    fireEvent.keyDown(sheet, { key: 'Tab' });
    expect(document.activeElement).toBe(links[0]);
    fireEvent.keyDown(sheet, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(links[2]);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(more);
  });

  it('closes on a tap outside, and when a tab is chosen', async () => {
    renderRail('/suivi');
    const more = await screen.findByRole('button', { name: 'Plus' });
    expect(more.getAttribute('data-current')).toBe('false');
    fireEvent.click(more);
    const scrim = document.querySelector('.nv-more-scrim');
    if (scrim === null) throw new Error('no scrim');
    fireEvent.click(scrim);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(more);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('link', { name: 'Réglages' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('« Plus » on the phone, signing out (recette 28/10, M14)', () => {
  const rail: Rail = {
    kind: 'chatter',
    items: [{ to: '/suivi', label: 'Suivi', icon: 'tracking', family: null }],
    settings: null,
    home: '/suivi',
    headed: new Set(),
    more: new Set(),
    phoneMenu: true,
  };

  function renderRail(onSignOut: () => void, shown: Rail = rail): void {
    const root = createRootRoute({
      component: (): JSX.Element => <RailNav rail={shown} current="/suivi" onSignOut={onSignOut} />,
    });
    const router = createRouter({
      routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/suivi' })]),
      history: createMemoryHistory({ initialEntries: ['/suivi'] }),
    });
    // The rail reads its counts (ADR 0134 § 8): a client of its own, as in the app.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
  }

  it('leaves « Plus » out when every tab fits and Moi › Préférences holds the rest (D-03)', async () => {
    renderRail(vi.fn(), {
      ...rail,
      items: [...rail.items, { to: '/moi', label: 'Moi', icon: 'me', family: null }],
      phoneMenu: false,
    });
    await screen.findByRole('link', { name: 'Moi' });
    expect(screen.queryByRole('button', { name: 'Plus' })).toBeNull();
  });

  it('offers to sign out, even on a rail whose tabs all fit on the bar', async () => {
    const onSignOut = vi.fn();
    renderRail(onSignOut);
    fireEvent.click(await screen.findByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    const out = within(sheet).getByRole('button', { name: 'Se déconnecter' });
    expect(document.activeElement).toBe(out);
    fireEvent.click(out);
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it('puts it under the tabs of the sheet in the app', async () => {
    renderApp(owner, '/');
    fireEvent.click(await screen.findByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    const lines = [...sheet.querySelectorAll('.nv-more__item')].map((line) => line.textContent);
    expect(lines.at(-1)).toBe('Se déconnecter');
  });
});

describe('Suivi › Alertes (P4-01, ADR 0134 § 5)', () => {
  const suiviTabs = async (): Promise<{ readonly label: string; readonly current: boolean }[]> =>
    within(await screen.findByRole('navigation', { name: 'Suivi' }))
      .getAllByRole('link')
      .map((link) => ({ label: link.textContent, current: link.getAttribute('aria-current') === 'page' }));

  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('is a view of Suivi for the owner and a manager, lit alone on its own address', async () => {
    renderApp(owner, '/suivi/alertes');
    expect(await suiviTabs()).toEqual([
      { label: 'Conversations', current: false },
      { label: 'Fans', current: false },
      { label: 'Alertes', current: true },
    ]);
    cleanup();
    renderApp(manager, '/suivi?conversation=0192f3a0-0000-7000-8000-0000000000d1');
    expect(await suiviTabs()).toEqual([
      { label: 'Conversations', current: true },
      { label: 'Fans', current: false },
      { label: 'Alertes', current: false },
    ]);
  });

  it('sends a chatter to his own Suivi, which has no such view', async () => {
    const router = renderApp(chatter, '/suivi/alertes');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/suivi');
    });
    expect(screen.queryByRole('navigation', { name: 'Suivi' })).toBeNull();
  });

  it('sends a creator home, as from all of Suivi', async () => {
    const router = renderApp({ ...base, role: 'creator', team: null, teamScope: 'self' }, '/suivi/alertes');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/aujourdhui');
    });
  });

  it('opens Fans as a view of Suivi, the address it had as a section leading there (ADR 0134 §§ 5, 10)', async () => {
    const router = renderApp(owner, '/fans');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/suivi/fans');
    });
    expect(await suiviTabs()).toEqual([
      { label: 'Conversations', current: false },
      { label: 'Fans', current: true },
      { label: 'Alertes', current: false },
    ]);
    // Lit under Suivi in the rail: Fans is no tab of its own any more.
    expect(tabs()).not.toContain('Fans');
  });

  it('keeps Fans from a chatter, on its old address too: he lands on his own Suivi', async () => {
    const router = renderApp(chatter, '/fans');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/suivi');
    });
    expect(screen.queryByRole('link', { name: 'Fans' })).toBeNull();
  });

  it('sends a chatter’s Moi › Calendrier to Planning, where « Dans mon téléphone » is, and leaves a manager’s (ADR 0134, lot 1)', async () => {
    const mine = renderApp(chatter, '/moi/calendrier');
    await waitFor(() => {
      expect(mine.state.location.pathname).toBe('/planning');
    });
    cleanup();
    const his = renderApp(manager, '/moi/calendrier');
    await waitFor(() => {
      expect(his.state.location.pathname).toBe('/moi/calendrier');
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Calendrier' })).toBeTruthy();
  });

  it('keeps under « Plus » the counts of the tabs it holds, for its dot (ADR 0134 § 8)', async () => {
    renderApp(owner, '/suivi');
    const more = await screen.findByRole('button', { name: /^Plus/u });
    // Nothing waits in this test: the holder is there, empty, and « Plus » reads bare.
    expect(more.querySelector('.nv-rail__under')).not.toBeNull();
    expect(more.querySelector('.nv-rail__under .nv-count')).toBeNull();
  });

  it('closes the manager’s Agence before Moi, a tab of no family (ADR 0149 § 2)', async () => {
    renderApp(manager, '/suivi');
    const moi = await screen.findByRole('link', { name: 'Moi' });
    expect(moi.previousElementSibling?.className).toBe('nv-rail__gap');
    expect(screen.getByText('Agence').className).toBe('nv-rail__heading');
  });
});

describe('an address that leads nowhere (recette 28/10, M1)', () => {
  it('says so in French, lights no tab, and leads back to the first one', async () => {
    renderApp(owner, '/nimporte-quoi');
    expect(await screen.findByRole('heading', { name: 'Cette page n’existe pas' })).toBeDefined();
    expect(screen.queryByText('Not Found')).toBeNull();
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(nav.querySelector('[aria-current="page"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'Revenir à Dashboard' }).getAttribute('href')).toBe('/');
    expect(document.title).toBe('Page introuvable · Impera');
  });
});

describe('a broken link (recette 16/11, CHT-06)', () => {
  it('opens a chatter’s planning on this week, never an error in English', async () => {
    renderApp(chatter, '/planning?semaine=abc&mois=zz');
    expect(await screen.findByRole('heading', { name: 'Planning', level: 1 })).toBeDefined();
    expect(screen.queryByText(/Something went wrong/u)).toBeNull();
    expect(screen.queryByText('Cette page n’a pas pu s’afficher')).toBeNull();
  });
});

describe('the tab’s title (recette 28/10, M2)', () => {
  it('names the screen on show', async () => {
    const router = renderApp(owner, '/suivi');
    await waitFor(() => {
      expect(document.title).toBe('Suivi · Impera');
    });
    await router.navigate({ to: '/creatrices' });
    await waitFor(() => {
      expect(document.title).toBe('Créatrices · Impera');
    });
  });
});

describe('the shell’s landmarks (design 29/10)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('lights no tab on an unknown screen inside a section (NAV-01)', async () => {
    renderApp(owner, '/equipe/nexiste-pas');
    expect(await screen.findByRole('heading', { name: 'Cette page n’existe pas' })).toBeDefined();
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(nav.querySelector('[aria-current="page"]')).toBeNull();
  });

  it('names the view and its section in the tab’s title (NAV-12)', async () => {
    renderApp(owner, '/equipe/membres');
    await waitFor(() => {
      expect(document.title).toBe('Membres · Équipe · Impera');
    });
  });

  it('leaves the agent’s mode to the Dashboard’s own control on the Dashboard (NAV-07)', async () => {
    const router = renderApp(owner, '/');
    await screen.findByText('Chatting');
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(nav.querySelector('.nv-rail__agent')).toBeNull();
    await router.navigate({ to: '/suivi' });
    await waitFor(() => {
      expect(nav.querySelector('.nv-rail__agent')).not.toBeNull();
    });
  });

  it('never shows a creator the agent’s pill, nor reads the Dashboard for her (CR-02 c2b)', async () => {
    const creator: Me = { ...base, role: 'creator', team: null, teamScope: 'self' };
    const router = renderApp(creator, '/aujourdhui');
    await screen.findByRole('heading', { name: 'Aujourd’hui', level: 1 });
    const nav = screen.getByRole('navigation', { name: 'Navigation' });
    expect(nav.querySelector('.nv-rail__agent')).toBeNull();
    await router.navigate({ to: '/moi/persona' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/moi/persona');
    });
    expect(nav.querySelector('.nv-rail__agent')).toBeNull();
    // `GET /v1/dashboard` answers her 403: nothing on her screens asks for it.
    const urls = vi.mocked(fetch).mock.calls.map(([url]) => (typeof url === 'string' ? url : ''));
    expect(urls.filter((url) => url.includes('/v1/dashboard'))).toEqual([]);
  });

  it('opens on a link to skip the rail, and puts the keyboard on the new section (NAV-20)', async () => {
    const router = renderApp(owner, '/suivi');
    const skip = await screen.findByRole('link', { name: 'Aller au contenu' });
    expect(skip.getAttribute('href')).toBe('#contenu');
    expect(document.getElementById('contenu')?.tagName).toBe('MAIN');
    await router.navigate({ to: '/creatrices' });
    await waitFor(() => {
      expect(document.getElementById('contenu')?.contains(document.activeElement)).toBe(true);
    });
  });
});

describe('the account’s menu (NAV-02, NAV-03)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('names who is signed in, holds the appearance and the way out, and closes on Escape', async () => {
    const onSignOut = vi.fn();
    const router = createAppRouter(
      { user: owner, onSignOut },
      createMemoryHistory({ initialEntries: ['/suivi'] }),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole('button', { name: /Nora/u });
    expect(button.textContent).toContain('Propriétaire');
    fireEvent.click(button);
    const menu = document.getElementById('nv-user-menu');
    if (menu === null) throw new Error('no menu');
    const night = within(menu).getByRole('radio', { name: 'Nuit' });
    expect(within(menu).getByRole('radiogroup', { name: 'Apparence' })).toBeDefined();
    fireEvent.keyDown(night, { key: 'ArrowRight' });
    expect(within(menu).getByRole('radio', { name: 'Jour' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(within(menu).getByRole('button', { name: 'Se déconnecter' }));
    expect(onSignOut).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.getElementById('nv-user-menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    localStorage.clear();
  });

  it('says the same on the phone, in « Plus »', async () => {
    renderApp(owner, '/');
    fireEvent.click(await screen.findByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    expect(within(sheet).getByText('Nora')).toBeDefined();
    expect(within(sheet).getByText('Propriétaire')).toBeDefined();
    expect(within(sheet).getByRole('radiogroup', { name: 'Apparence' })).toBeDefined();
    // What « Appareil » means is on screen: a phone has no hover to show a title.
    expect(
      within(sheet).getByText(
        'Appareil suit le réglage clair ou sombre du téléphone ou de l’ordinateur. Le choix vaut pour ce navigateur.',
      ),
    ).toBeDefined();
  });
});

describe('the account’s security, from its menu (SEC-04)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };
  const creator: Me = { ...base, role: 'creator', team: null, teamScope: 'self' };

  it('leads each role to its own screen', async () => {
    for (const [user, path] of [
      [owner, '/reglages/securite'],
      [manager, '/moi/securite'],
      [chatter, '/moi/securite'],
      [operator, '/compte/securite'],
      // Hers is in her Moi (ADR 0042 § 8).
      [creator, '/moi/securite'],
    ] satisfies [Me, string][]) {
      renderApp(user, '/suivi');
      fireEvent.click(await screen.findByRole('button', { name: /Nora/u }));
      const menu = document.getElementById('nv-user-menu');
      if (menu === null) throw new Error('no menu');
      expect(within(menu).getByRole('link', { name: 'Sécurité' }).getAttribute('href')).toBe(path);
      cleanup();
    }
  });

  it('opens outside the rail for an operator, never sent home, with a way back to his first tab', async () => {
    const router = renderApp(operator, '/compte/securite');
    const title = await screen.findByRole('heading', { level: 1, name: 'Sécurité' });
    expect(router.state.location.pathname).toBe('/compte/securite');
    expect(document.title).toBe('Sécurité · Impera');
    expect(screen.queryByRole('heading', { name: 'Comptes de l’agence' })).toBeNull();
    const back = within(title.parentElement ?? document.body).getByRole('link', { name: '← Dashboard' });
    expect(back.getAttribute('href')).toBe('/');
    expect(title.closest('.nv-page')?.getAttribute('data-width')).toBe('narrow');
  });

  // Recette visuelle 16/11 (CHA-16, CRE-07, GES-11): one page for one's security, not a second one off the rail.
  it('leads every other account from /compte/securite to its own page, its query kept', async () => {
    for (const [user, path] of [
      [manager, '/moi/securite'],
      [chatter, '/moi/securite'],
      [creator, '/moi/securite'],
      [owner, '/reglages/securite'],
    ] satisfies [Me, string][]) {
      const router = renderApp(user, '/compte/securite?depuis=menu#codes');
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(path);
      });
      expect(router.state.location.searchStr).toBe('?depuis=menu');
      expect(router.state.location.hash).toBe('codes');
      expect(await screen.findByRole('heading', { level: 1, name: 'Sécurité' })).toBeDefined();
      // Not refused: it is his own page, nothing to explain.
      expect(screen.queryByText('Cette page n’est pas dans ton espace.')).toBeNull();
      cleanup();
    }
  });

  it('draws his rail as one list, no gap between tabs of families without a heading (PIL-15)', async () => {
    renderApp(operator, '/');
    const rail = await screen.findByRole('navigation', { name: 'Navigation' });
    expect(rail.querySelectorAll('.nv-rail__heading')).toHaveLength(0);
    expect(rail.querySelectorAll('.nv-rail__gap')).toHaveLength(0);
  });

  it('is in « Plus » on the phone', async () => {
    renderApp(operator, '/');
    fireEvent.click(await screen.findByRole('button', { name: 'Plus' }));
    const sheet = screen.getByRole('dialog', { name: 'Plus' });
    expect(within(sheet).getByRole('link', { name: 'Sécurité' }).getAttribute('href')).toBe(
      '/compte/securite',
    );
  });
});

describe('the shell while a screen loads (review of #313)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('never reads « introuvable » on the way between two sub-tabs, keeps its stage, and leaves the focus alone', async () => {
    const router = renderApp(owner, '/equipe/membres');
    await waitFor(() => {
      expect(document.title).toBe('Membres · Équipe · Impera');
    });
    const stage = document.getElementById('contenu');
    const titles: string[] = [];
    const observer = new MutationObserver(() => {
      titles.push(document.title);
    });
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    const lit: (string | null)[] = [];
    const unsubscribe = router.subscribe('onBeforeRouteMount', () => {
      lit.push(document.querySelector('.nv-rail [aria-current="page"]')?.getAttribute('title') ?? null);
    });
    await router.navigate({ to: '/equipe/rapports' });
    await waitFor(() => {
      expect(document.title).toBe('Rapports · Équipe · Impera');
    });
    observer.disconnect();
    unsubscribe();
    expect(titles.filter((title) => title.startsWith('Page introuvable'))).toEqual([]);
    expect(lit.filter((title) => title !== 'Équipe')).toEqual([]);
    expect(document.getElementById('contenu')).toBe(stage);
    expect(document.activeElement?.tagName).not.toBe('H1');
  });

  it('says « pas dans ton espace » on a link followed inside the app, even to the screen already shown', async () => {
    const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };
    const router = renderApp(operator, '/');
    await screen.findByRole('navigation', { name: 'Navigation' });
    const region = screen.getAllByRole('status').find((node) => node.classList.contains('nv-notice-region'));
    // The region is there before it speaks: a screen reader announces what comes into it.
    expect(region?.textContent).toBe('');
    await router.navigate({ to: '/reglages/alertes' });
    await waitFor(() => {
      expect(region?.textContent).toBe('Cette page n’est pas dans ton espace.');
    });
    expect(router.state.location.pathname).toBe('/');
  });

  it('says it too when a tab of the rail turns a manager away: the exports, a member’s file (recette EQP-03)', async () => {
    for (const [at, home] of [
      ['/paie/exports', '/paie/quinzaine'],
      ['/equipe/membres/m1/dossier', '/equipe/membres'],
    ] as const) {
      const router = renderApp(manager, at);
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(home);
      });
      expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();
      cleanup();
    }
  });

  it('says nothing when the app opens on its own address, for a rail without the Dashboard (relecture #484)', async () => {
    const creator: Me = { ...base, role: 'creator', creatorIds: [], team: null, teamScope: 'self' };
    for (const [user, home] of [
      [creator, '/aujourdhui'],
      [chatter, '/aujourdhui'],
    ] satisfies [Me, string][]) {
      const router = renderApp(user, '/');
      await waitFor(() => {
        expect(router.state.location.pathname).toBe(home);
      });
      await screen.findByRole('navigation', { name: 'Navigation' });
      const region = screen
        .getAllByRole('status')
        .find((node) => node.classList.contains('nv-notice-region'));
      expect(region?.textContent).toBe('');
      expect(screen.queryByText('Cette page n’est pas dans ton espace.')).toBeNull();
      cleanup();
    }
  });

  it('says it once: neither « Précédent » nor a reload says it again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };
    const router = renderApp(operator, '/reglages/alertes');
    expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();
    await waitFor(() => {
      expect(router.state.location.state.notice).toBeUndefined();
    });
    vi.advanceTimersByTime(6_000);
    await waitFor(() => {
      expect(screen.queryByText('Cette page n’est pas dans ton espace.')).toBeNull();
    });
    await router.navigate({ to: '/suivi' });
    router.history.back();
    await waitFor(() => {
      expect(router.state.resolvedLocation?.pathname).toBe('/');
    });
    expect(screen.queryByText('Cette page n’est pas dans ton espace.')).toBeNull();
    vi.useRealTimers();
  });

  it('says it under StrictMode too, as in the app', async () => {
    const operator: Me = { ...base, role: 'operator', team: null, teamScope: 'self' };
    const router = createAppRouter(
      { user: operator, onSignOut: () => undefined },
      createMemoryHistory({ initialEntries: ['/reglages/alertes'] }),
    );
    render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </StrictMode>,
    );
    expect(await screen.findByText('Cette page n’est pas dans ton espace.')).toBeDefined();
  });
});

// Recette visuelle 16/11 (COH-02, CHA-11, CRE-09): one width per section, the reading ones narrow.
describe('the width of each section without tabs', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  });

  const creator: Me = { ...base, role: 'creator', team: null, teamScope: 'self', creatorIds: ['c1'] };
  it.each([
    // Two columns on a computer: who to talk to, his figures beside (Charles, 21/11).
    ['/aujourdhui', 'Aujourd’hui', 'wide', chatter],
    ['/planning', 'Planning', 'narrow', chatter],
    ['/notifications', 'Notifications', 'narrow', chatter],
    ['/aide/installer', 'Installer Impera', 'narrow', chatter],
    ['/aide/extension', 'Installer l’extension', 'narrow', chatter],
    ['/aujourdhui', 'Aujourd’hui', 'narrow', creator],
    ['/contenu', 'Contenu', 'narrow', creator],
    ['/agenda', 'Agenda', 'wide', creator],
    ['/ventes', 'Ventes', 'wide', creator],
    ['/creatrices', 'Créatrices', 'wide', owner],
    ['/creatrices/structures', 'Structures de script', 'wide', owner],
  ] satisfies [string, string, 'wide' | 'narrow', Me][])(
    'lays %s (« %s ») in the %s column',
    async (path, title, width, user) => {
      renderApp(user, path);
      const heading = await screen.findByRole('heading', { level: 1, name: title });
      expect(heading.closest('.nv-page')?.getAttribute('data-width')).toBe(width);
    },
  );
});

// Recette visuelle 16/11 (PIL-17): an address of Entraîner with no screen yet leads to the Playground and says so.
describe('an address of Entraîner with no screen yet', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
  });

  it.each(['/entrainer/tests'])('leads %s to the Playground, and says why', async (path) => {
    const router = renderApp(owner, path);
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/entrainer/playground');
    });
    expect(await screen.findByText('Cet écran arrive bientôt : tu es sur le Playground.')).toBeDefined();
  });

  it('says nothing on its own address, which opens the Playground as its first tab', async () => {
    const router = renderApp(owner, '/entrainer');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/entrainer/playground');
    });
    await screen.findByRole('heading', { level: 1, name: 'Chatting' });
    expect(screen.queryByText('Cet écran arrive bientôt : tu es sur le Playground.')).toBeNull();
  });
});

// Recette visuelle 16/11 (T9): the guides hang from Réglages for the owner, who has no Moi.
describe('a guide opened by the owner', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('lights Réglages and leads back to it', async () => {
    renderApp(owner, '/aide/reveal');
    const title = await screen.findByRole('heading', { level: 1, name: 'Reconnecter Reveal' });
    const back = within(title.parentElement ?? document.body).getByRole('link', { name: '← Réglages' });
    expect(back.getAttribute('href')).toBe('/reglages');
    expect(
      screen
        .getByRole('navigation', { name: 'Navigation' })
        .querySelector('[aria-current="page"]')
        ?.getAttribute('title'),
    ).toBe('Réglages');
  });
});

describe('the header of a section with sub-tabs (NAV-08)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = vi.fn();
        disconnect = vi.fn();
      },
    );
  });

  it('stays put when a sub-tab is chosen, and plays again in another section', async () => {
    const router = renderApp(owner, '/equipe/planning');
    await screen.findByRole('navigation', { name: 'Équipe' });
    const stage = (): HTMLElement | null => document.getElementById('contenu');
    expect(stage()?.hasAttribute('data-within')).toBe(false);
    await router.navigate({ to: '/equipe/membres' });
    await waitFor(() => {
      expect(stage()?.hasAttribute('data-within')).toBe(true);
    });
    await router.navigate({ to: '/paie/releves' });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/paie/releves');
    });
    expect(stage()?.hasAttribute('data-within')).toBe(false);
  });

  it('says under each section’s title what the screen is for (NAV-11)', async () => {
    // The Playground listens to the phone's width.
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
    );
    for (const [path, lead] of [
      [
        '/entrainer/playground',
        'Parle à la persona comme un fan, avant qu’un vrai fan ne la lise : rien n’est envoyé.',
      ],
      ['/reglages/modeles-ia', 'Ce qui règle le CRM pour toute l’agence.'],
      ['/creatrices', 'Tes créatrices d’un coup d’œil. Ouvre-en une pour sa fiche et tous ses réglages.'],
    ] as const) {
      renderApp(owner, path);
      const title = await screen.findByRole('heading', { level: 1 });
      expect(title.parentElement?.querySelector('.nv-page__lead')?.textContent).toBe(lead);
      cleanup();
    }
  });

  // Recette visuelle 16/11 (T1, T2, T3): the section above the title, the open tab as the title, the tabs on a row of
  // their own (never in the actions), and one width for every tab of a section.
  it.each([
    ['/suivi', 'Suivi', 'Conversations', 'wide', owner],
    ['/suivi/alertes', 'Suivi', 'Alertes', 'wide', owner],
    ['/entrainer/playground', 'Entraîner', 'Chatting', 'wide', owner],
    ['/entrainer/canal', 'Entraîner', 'Post du canal', 'wide', owner],
    ['/equipe/planning', 'Équipe', 'Planning', 'wide', owner],
    ['/equipe/rapports', 'Équipe', 'Rapports', 'wide', owner],
    ['/equipe/membres', 'Équipe', 'Membres', 'wide', owner],
    // Équipe › Comptes Reveal: its tab comes with the server's counts, which this shell test never answers.
    ['/paie/quinzaine', 'Paie', 'Quinzaine', 'wide', owner],
    ['/paie/releves', 'Paie', 'Historique', 'wide', owner],
    ['/paie/primes-malus', 'Paie', 'Primes et malus', 'wide', owner],
    ['/paie/objectifs', 'Paie', 'Objectifs', 'wide', owner],
    ['/paie/factures', 'Paie', 'Factures', 'wide', owner],
    ['/paie/exports', 'Paie', 'Exports', 'wide', owner],
    ['/moi/profil', 'Moi', 'Profil', 'narrow', manager],
    ['/moi/dossier', 'Moi', 'Dossier', 'narrow', manager],
    ['/moi/factures', 'Moi', 'Factures', 'narrow', manager],
    ['/moi/calendrier', 'Moi', 'Calendrier', 'narrow', manager],
    ['/moi/securite', 'Moi', 'Sécurité', 'narrow', manager],
    ['/moi/preferences', 'Moi', 'Préférences', 'narrow', manager],
    ['/commissions', 'Commissions', 'Relevés', 'wide', chatter],
    ['/commissions/factures', 'Commissions', 'Factures', 'wide', chatter],
    ['/moi/profil', 'Moi', 'Profil', 'narrow', chatter],
    [
      '/moi/persona',
      'Moi',
      'Persona',
      'narrow',
      { ...base, role: 'creator', team: null, teamScope: 'self' } satisfies Me,
    ],
  ] satisfies [string, string, string, 'wide' | 'narrow', Me][])(
    'titles %s by its tab under « %s » (« %s »), its tabs on their own row, %s',
    async (path, section, tab, width, user) => {
      // The Playground listens to the phone's width.
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
      );
      renderApp(user, path);
      const title = await screen.findByRole('heading', { level: 1, name: tab });
      const head = title.closest<HTMLElement>('.nv-page__head');
      if (head === null) throw new Error('no header');
      expect(head.querySelector('.nv-page__title > .nv-eyebrow')?.textContent).toBe(section);
      const tabs = await within(head).findByRole('navigation', { name: section });
      expect(tabs.closest('.nv-page__tabs')?.parentElement).toBe(head);
      expect(tabs.closest('.nv-page__actions')).toBeNull();
      expect(
        within(tabs)
          .getByRole('link', { name: new RegExp(`^${tab}`, 'u') })
          .getAttribute('aria-current'),
      ).toBe('page');
      expect(head.closest('.nv-page')?.getAttribute('data-width')).toBe(width);
    },
  );

  // Recette visuelle 16/11 (GES-04): Réglages is a list beside its section, not tabs; the header keeps the template.
  it.each([
    ['/reglages/modeles-ia', 'Modèles IA'],
    ['/reglages/ventes', 'Plateformes'],
    ['/reglages/consommation-ia', 'Consommation IA'],
    ['/reglages/alertes', 'Alertes'],
    ['/reglages/telegram', 'Bots Telegram'],
    ['/reglages/regles-de-paie', 'Règles de paie'],
    ['/reglages/facturation', 'Facturation'],
    ['/reglages/sauvegardes', 'Sauvegardes'],
    ['/reglages/securite', 'Sécurité'],
  ] as const)(
    'titles %s by its section under « Réglages » (« %s »), its list beside it, wide',
    async (path, name) => {
      vi.stubGlobal(
        'matchMedia',
        vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
      );
      renderApp(owner, path);
      const title = await screen.findByRole('heading', { level: 1, name });
      const head = title.closest<HTMLElement>('.nv-page__head');
      if (head === null) throw new Error('no header');
      expect(head.querySelector('.nv-page__title > .nv-eyebrow > .rgl-eyebrow')?.textContent).toBe(
        'Réglages',
      );
      expect(head.querySelector('.nv-page__tabs')).toBeNull();
      const list = await screen.findByRole('navigation', { name: 'Réglages' });
      expect(list.closest('.rgl-body')?.parentElement).toBe(head.parentElement);
      expect(
        within(list)
          .getByRole('link', { name: new RegExp(`^${name}`, 'u') })
          .getAttribute('aria-current'),
      ).toBe('page');
      expect(head.closest('.nv-page')?.getAttribute('data-width')).toBe('wide');
    },
  );
});
