// @vitest-environment jsdom
import type { Me } from '@nirvana/contracts';
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

const base = { id: 'u1', email: 'membre@example.test', name: 'Nora', creatorIds: [], routedCreatorIds: [] };
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
    vi.fn(() => ({ matches: true })),
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
  it('gives the owner his tabs in the order of ADR 0024, under Chatting and Agence', async () => {
    renderApp(owner, '/');
    await screen.findByText('Chatting');
    expect(tabs()).toEqual(['Dashboard', 'Suivi', 'Entraîner', 'Équipe', 'Paie', 'Créatrices', 'Réglages']);
    expect(screen.getByText('Agence')).toBeDefined();
    // Seven places: the phone keeps four on its bar and folds the rest under « Plus ».
    expect(screen.getByRole('button', { name: 'Plus' })).toBeDefined();
    expect(screen.getByText('Propriétaire')).toBeDefined();
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
    expect(tabs()).toEqual(['Aujourd’hui', 'Suivi', 'Planning', 'Commissions']);
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
    expect(tabs()).toEqual(['Aujourd’hui', 'Suivi', 'Planning', 'Commissions']);
  });

  it('sends a creator who opens Suivi to the Dashboard: she never sees a conversation', async () => {
    const router = renderApp(
      { ...base, role: 'creator', team: null, teamScope: 'self' },
      '/suivi?conversation=c1',
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    // Her own persona, and no Réglages: every page of it is the owner's (NAV-18).
    expect(tabs()).toEqual(['Dashboard', 'Persona']);
    expect(screen.getByText('Créatrice')).toBeDefined();
  });

  it('keeps a manager out of Entraîner and Réglages', async () => {
    const router = renderApp(manager, '/reglages/modeles-ia');
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(tabs()).toEqual(['Dashboard', 'Suivi', 'Équipe', 'Paie']);
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

  it('is a tab of the owner, after Telegram and the pay rules', async () => {
    const router = renderApp(owner, '/reglages/sauvegardes');
    expect(await subTabs()).toEqual(['Modèles IA', 'Alertes', 'Telegram', 'Règles de paie', 'Sauvegardes']);
    expect(router.state.location.pathname).toBe('/reglages/sauvegardes');
  });

  // Réglages is the owner's alone (NAV-18): any of its addresses sends anyone else to the Dashboard, and says why.
  it('sends an operator or a creator from any page of Réglages to the Dashboard, and says why (NAV-21)', async () => {
    for (const path of [
      '/reglages/sauvegardes',
      '/reglages/alertes',
      '/reglages/regles-de-paie',
      '/reglages/apparence',
    ]) {
      for (const user of [
        { ...base, role: 'operator', team: null, teamScope: 'self' },
        { ...base, role: 'creator', team: null, teamScope: 'self' },
      ] satisfies Me[]) {
        const router = renderApp(user, path);
        await waitFor(() => {
          expect(router.state.location.pathname).toBe('/');
        });
        const said = await screen.findByText('Cette page n’est pas dans ton espace.');
        expect(said.closest('[role="status"]')).not.toBeNull();
        expect(screen.queryByRole('navigation', { name: 'Réglages' })).toBeNull();
        cleanup();
      }
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
    render(<RouterProvider router={router} />);
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
  };

  function renderRail(onSignOut: () => void): void {
    const root = createRootRoute({
      component: (): JSX.Element => <RailNav rail={rail} current="/suivi" onSignOut={onSignOut} />,
    });
    const router = createRouter({
      routeTree: root.addChildren([createRoute({ getParentRoute: () => root, path: '/suivi' })]),
      history: createMemoryHistory({ initialEntries: ['/suivi'] }),
    });
    render(<RouterProvider router={router} />);
  }

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

describe('Suivi › Historique des alertes (P4-01)', () => {
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
      { label: 'Historique des alertes', current: true },
    ]);
    cleanup();
    renderApp(manager, '/suivi?conversation=0192f3a0-0000-7000-8000-0000000000d1');
    expect(await suiviTabs()).toEqual([
      { label: 'Conversations', current: true },
      { label: 'Historique des alertes', current: false },
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
      expect(router.state.location.pathname).toBe('/');
    });
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
    expect(document.title).toBe('Page introuvable · Nirvana');
  });
});

describe('the tab’s title (recette 28/10, M2)', () => {
  it('names the screen on show', async () => {
    const router = renderApp(owner, '/suivi');
    await waitFor(() => {
      expect(document.title).toBe('Suivi · Nirvana');
    });
    await router.navigate({ to: '/creatrices' });
    await waitFor(() => {
      expect(document.title).toBe('Créatrices · Nirvana');
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
      expect(document.title).toBe('Membres · Équipe · Nirvana');
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
      expect(document.title).toBe('Membres · Équipe · Nirvana');
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
      expect(document.title).toBe('Rapports · Équipe · Nirvana');
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
      ['/creatrices', 'La fiche de chaque créatrice : sa persona et ses heures d’activité.'],
    ] as const) {
      renderApp(owner, path);
      const title = await screen.findByRole('heading', { level: 1 });
      expect(title.parentElement?.querySelector('.nv-page__lead')?.textContent).toBe(lead);
      cleanup();
    }
  });

  it('says no sub-tab’s name above the title: the lit sub-tab says it (NAV-09)', async () => {
    renderApp(owner, '/equipe/rapports');
    const title = await screen.findByRole('heading', { level: 1, name: 'Équipe' });
    expect(title.parentElement?.querySelector('.nv-eyebrow')).toBeNull();
  });
});
