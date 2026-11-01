// @vitest-environment jsdom
import { CreatorIdSchema, TelegramBotIdSchema, TelegramChatIdSchema } from '@nirvana/contracts';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramSection } from './TelegramSection';
import {
  TelegramForbidden,
  TelegramOff,
  fetchDeliveries,
  fetchOverview,
  removeChat,
  saveRoutes,
} from './api';
import { parseTelegramSearch, searchOfTab, tabOfSearch } from './search';

vi.mock('./api', async (actual) => ({
  ...(await actual<typeof import('./api')>()),
  fetchOverview: vi.fn(),
  fetchDeliveries: vi.fn(),
  saveRoutes: vi.fn(),
  removeChat: vi.fn(),
}));

function renderSection(): void {
  const rootRoute = createRootRoute();
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: TelegramSection });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.mocked(fetchDeliveries).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('Réglages › Telegram when the page cannot load', () => {
  it('blames the server, not Telegram, when Nirvana itself does not answer', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new TypeError('Failed to fetch'));
    renderSection();
    expect(await screen.findByText('Le serveur ne répond pas')).toBeTruthy();
    expect(screen.queryByText(/Telegram ne répond pas/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeTruthy();
  });

  it('says Telegram is off when the server runs without it', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new TelegramOff());
    renderSection();
    expect(await screen.findByText('Telegram n’est pas activé sur ce serveur')).toBeTruthy();
    // An installation setting, said without the server's vocabulary.
    expect(screen.queryByText(/CREDENTIALS_ENCRYPTION_KEYS/)).toBeNull();
    expect(screen.queryByText('Le serveur ne répond pas')).toBeNull();
  });

  it('tells a member who is not the owner whose page it is, with nothing to retry', async () => {
    vi.mocked(fetchOverview).mockRejectedValue(new TelegramForbidden());
    renderSection();
    expect(await screen.findByText('Seul le propriétaire règle Telegram')).toBeTruthy();
    expect(screen.queryByText('Le serveur ne répond pas')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
  });
});

describe('Réglages › Telegram with a bot Telegram refuses', () => {
  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({
      bots: [
        {
          id: TelegramBotIdSchema.parse('01900000-0000-7000-8000-0000000000b2'),
          username: 'refuse_bot',
          displayName: 'Refusé',
          state: 'refused',
          lastPolledAt: null,
          chats: [
            {
              id: TelegramChatIdSchema.parse('01900000-0000-7000-8000-0000000000c2'),
              title: 'Astreinte',
              kind: 'group',
              membership: 'member',
              canPost: true,
              lastSentAt: null,
              lastError: null,
            },
          ],
        },
      ],
      routes: [],
      coverage: [
        {
          creatorId: CreatorIdSchema.parse('01900000-0000-7000-8000-0000000000a1'),
          displayName: 'Démo',
          urgentReachable: false,
          topicsWithoutGroup: [],
        },
      ],
      version: 1,
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('offers to repair that bot, not to choose a group or add a new bot', async () => {
    renderSection();
    expect(await screen.findByText('Les alertes ne partent plus')).toBeTruthy();
    expect(screen.queryByText(/Choisis au moins un groupe/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mettre un bot dans un groupe' })).toBeNull();
    const [repair] = screen.getAllByRole('button', { name: 'Réparer le bot' });
    if (repair === undefined) throw new Error('no « Réparer le bot »');
    fireEvent.click(repair);
    expect(await screen.findByRole('tab', { name: /Bots et groupes/, selected: true })).toBeTruthy();
  });

  it('says « son groupe » for a bot that serves one group', async () => {
    renderSection();
    const [repair] = await screen.findAllByRole('button', { name: 'Réparer le bot' });
    if (repair === undefined) throw new Error('no « Réparer le bot »');
    fireEvent.click(repair);
    fireEvent.click(await screen.findByRole('button', { name: 'Supprimer' }));
    expect(await screen.findByText(/Son groupe ne recevra plus rien\./)).toBeTruthy();
    expect(screen.queryByText(/Ses 1 groupe/)).toBeNull();
  });

  it('lights « Réparer » alone, without a second button that does the same', async () => {
    renderSection();
    const [repair] = await screen.findAllByRole('button', { name: 'Réparer le bot' });
    if (repair === undefined) throw new Error('no « Réparer le bot »');
    fireEvent.click(repair);
    const fix = await screen.findByRole('button', { name: 'Réparer' });
    expect(fix.className).toContain('nv-btn--neon');
    expect(screen.queryByRole('button', { name: 'Remplacer le jeton' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ajouter un bot' }).className).not.toContain('nv-btn--neon');
  });

  it('leads from the state strip to the tab where the bot is repaired', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: /Les urgences n’arrivent nulle part/ }));
    expect(await screen.findByRole('tab', { name: /Bots et groupes/, selected: true })).toBeTruthy();
  });
});

describe('Réglages › Telegram without a bot', () => {
  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({ bots: [], routes: [], coverage: [], version: 0 });
  });

  it('shows one empty state and its one action, no strip and no tabs', async () => {
    renderSection();
    expect(await screen.findByText('Personne n’est prévenu la nuit')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Ajouter un bot' })).toHaveLength(1);
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mettre un bot dans un groupe' })).toBeNull();
  });
});

describe('Réglages › Telegram with its tab in the address', () => {
  /** Renders the page at `address`; gives what the address now holds and how many steps back it has. */
  function renderAt(address: string): () => { search: unknown; steps: number } {
    const rootRoute = createRootRoute();
    const page = createRoute({
      getParentRoute: () => rootRoute,
      // Its own path in the app: the route's search is typed by the app's route of that path.
      path: '/reglages/telegram',
      validateSearch: parseTelegramSearch,
      component: function Page() {
        const search = page.useSearch();
        const navigate = page.useNavigate();
        return (
          <TelegramSection
            tab={tabOfSearch(search)}
            onTab={(tab) => void navigate({ search: searchOfTab(tab), replace: true })}
          />
        );
      },
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([page]),
      history: createMemoryHistory({ initialEntries: [address] }),
    });
    render(<RouterProvider router={router} />);
    return () => ({ search: router.state.location.search, steps: router.history.length });
  }

  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({
      bots: [
        {
          id: TelegramBotIdSchema.parse('01900000-0000-7000-8000-0000000000b3'),
          username: 'demo_bot',
          displayName: 'Démo',
          state: 'active',
          lastPolledAt: null,
          chats: [],
        },
      ],
      routes: [],
      coverage: [],
      version: 0,
    });
    // jsdom lays nothing out: the chosen tab scrolls into view on a phone, here a no-op.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('opens Ventes from ?onglet=ventes, as a link from Réglages › Alertes does', async () => {
    renderAt('/reglages/telegram?onglet=ventes');
    expect((await screen.findByRole('tab', { name: /Ventes/ })).getAttribute('aria-selected')).toBe('true');
  });

  it('falls back on « Qui est prévenu » for a tab it does not know, without an error', async () => {
    renderAt('/reglages/telegram?onglet=inconnu');
    expect((await screen.findByRole('tab', { name: /Qui est prévenu/ })).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('has no Mots-clés tab: the keywords are a line of « Qui est prévenu », where an old link lands', async () => {
    renderAt('/reglages/telegram?onglet=mots-cles');
    expect((await screen.findByRole('tab', { name: /Qui est prévenu/ })).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('tab', { name: /Mots-clés/ })).toBeNull();
    expect(screen.getByText('Mots-clés')).toBeTruthy();
  });

  it('writes a tab change in the address in place, without one more step back', async () => {
    const address = renderAt('/reglages/telegram');
    fireEvent.click(await screen.findByRole('tab', { name: /Bots et groupes/ }));
    expect(await screen.findByRole('tab', { name: /Bots et groupes/, selected: true })).toBeTruthy();
    expect(address()).toEqual({ search: { onglet: 'bots' }, steps: 1 });
  });
});

describe('Réglages › Telegram, her own alerts (P4-01)', () => {
  const chatId = TelegramChatIdSchema.parse('01900000-0000-7000-8000-0000000000c1');

  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({
      bots: [
        {
          id: TelegramBotIdSchema.parse('01900000-0000-7000-8000-0000000000b1'),
          username: 'demo_bot',
          displayName: 'Démo',
          state: 'active',
          lastPolledAt: null,
          chats: [
            {
              id: chatId,
              title: 'Équipe',
              kind: 'supergroup',
              membership: 'member',
              canPost: true,
              lastSentAt: null,
              lastError: null,
            },
          ],
        },
      ],
      routes: [],
      coverage: [],
      version: 3,
    });
    vi.mocked(saveRoutes).mockResolvedValue({ ok: true, value: { routes: [], version: 4 } });
  });

  it('routes « Alertes personnalisées » from the Alertes tab, as Réglages › Alertes links to', async () => {
    renderSection();
    const row = await screen.findByRole('group', { name: 'Groupes pour Alertes personnalisées' });
    fireEvent.click(within(row).getByRole('checkbox', { name: /Équipe/ }));
    await waitFor(() => {
      expect(saveRoutes).toHaveBeenCalledWith(3, [{ creatorId: null, topic: 'custom', chatId }]);
    });
  });

  it('says under Mots-clés that without a group a keyword warns no one, then stops saying it', async () => {
    renderSection();
    const hint = 'Sans groupe choisi ici, un mot-clé ne prévient personne sur Telegram.';
    expect(await screen.findByText(hint)).toBeTruthy();
    // The keywords are not « Important »: that line no longer claims them.
    expect(screen.getByText('Plafond IA, session expirée, agent arrêté')).toBeTruthy();
    const row = screen.getByRole('group', { name: 'Groupes pour Mots-clés' });
    fireEvent.click(within(row).getByRole('checkbox', { name: /Équipe/ }));
    await waitFor(() => {
      expect(screen.queryByText(hint)).toBeNull();
    });
  });

  it('says under Mots-clés what a keyword does, and links to the Persona where the words are set', async () => {
    renderSection();
    expect(
      await screen.findByText(
        /Un mot de sa Persona arrête l’agent pour ce fan ; le groupe reçoit le mot trouvé et un lien/,
      ),
    ).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Modifier les mots dans la Persona' }).getAttribute('href')).toBe(
      '/creatrices',
    );
  });
});

describe('Réglages › Telegram with a group the bot was banned from (REG-28)', () => {
  const gone = TelegramChatIdSchema.parse('01900000-0000-7000-8000-0000000000c9');
  beforeEach(() => {
    vi.mocked(fetchOverview).mockResolvedValue({
      bots: [
        {
          id: TelegramBotIdSchema.parse('01900000-0000-7000-8000-0000000000b9'),
          username: 'demo_bot',
          displayName: 'Démo',
          state: 'active',
          lastPolledAt: null,
          chats: [
            {
              id: TelegramChatIdSchema.parse('01900000-0000-7000-8000-0000000000c8'),
              title: 'Astreinte',
              kind: 'group',
              membership: 'member',
              canPost: true,
              lastSentAt: null,
              lastError: null,
            },
            {
              id: gone,
              title: 'Ancien groupe',
              kind: 'supergroup',
              membership: 'kicked',
              canPost: false,
              lastSentAt: null,
              lastError: null,
            },
          ],
        },
      ],
      routes: [{ creatorId: null, topic: 'urgent', chatId: gone }],
      coverage: [],
      version: 4,
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('says why, asks in the page, and removes the group only once confirmed', async () => {
    vi.mocked(removeChat).mockResolvedValue('removed');
    renderSection();
    fireEvent.click(await screen.findByRole('tab', { name: /Bots et groupes/ }));
    expect(await screen.findByText('Supergroupe · le bot a été exclu de ce groupe')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer de la liste' }));
    expect(screen.getByText('Retirer Ancien groupe de la liste ?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Garder' }));
    expect(removeChat).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer de la liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    await waitFor(() => {
      expect(removeChat).toHaveBeenCalledWith(gone);
    });
  });

  it('shows the removal under way and takes no second click', async () => {
    let finish: (result: 'removed') => void = () => undefined;
    vi.mocked(removeChat).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderSection();
    fireEvent.click(await screen.findByRole('tab', { name: /Bots et groupes/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer de la liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    const busy = await screen.findByRole('button', { name: 'Retrait…' });
    expect(busy).toHaveProperty('disabled', true);
    finish('removed');
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Retrait…' })).toBeNull();
    });
    expect(removeChat).toHaveBeenCalledTimes(1);
  });

  it('keeps the group when the bot came back in meanwhile, and says so', async () => {
    vi.mocked(removeChat).mockResolvedValue('still_member');
    renderSection();
    fireEvent.click(await screen.findByRole('tab', { name: /Bots et groupes/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer de la liste' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Le bot est revenu dans Ancien groupe : le groupe reste.',
    );
  });
});
