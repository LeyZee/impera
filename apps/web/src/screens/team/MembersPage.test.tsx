// @vitest-environment jsdom
import { TeamMemberSchema, type TeamMember } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
  type AnyRouter,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersPage } from './MembersPage';
import { parseTeamSearch } from './model';

const confirmPassword = vi.fn<(password: string) => Promise<string>>();
vi.mock('@/settings/services/api', () => ({
  confirmPassword: (password: string) => confirmPassword(password),
}));

/* Invented members and creators: no real data (ADR 0010). */
const LEA = { id: '0192f3a0-0000-7000-8000-0000000000c1', displayName: 'Léa', timezone: 'Europe/Paris' };
const PRESET = '0199f2a0-0000-7000-8000-0000000000b1';
const PRESETS = [{ id: PRESET, name: 'Confirmé', rateBps: 1500, effectiveFrom: '2026-10-01' }];
const id = (n: number): string => `0199f2a0-0000-7000-8000-0000000000${String(n)}`;

function member(n: number, patch: Partial<TeamMember> = {}): TeamMember {
  return TeamMemberSchema.parse({
    id: id(n),
    userId: id(n + 50),
    email: 'membre@example.test',
    firstName: 'Théo',
    lastName: 'Martin',
    displayName: 'Théo',
    teamRole: 'chatter',
    status: 'active',
    country: 'BJ',
    timeZone: 'Africa/Porto-Novo',
    color: null,
    joinedOn: '2026-09-01',
    creatorIds: [LEA.id],
    commission: { rateBps: 1500, teamShareBps: null, presetId: PRESET, effectiveFrom: '2026-09-01' },
    invitationPending: false,
    invitationExpiresAt: null,
    ...patch,
  });
}

const THEO = member(11);
const BASILE = member(12, {
  displayName: 'Basile',
  firstName: 'Basile',
  status: 'on_leave',
  commission: null,
});
const JULES = member(13, { displayName: 'Jules', firstName: 'Jules', status: 'left' });
const INES = member(14, { displayName: 'Inès', firstName: 'Inès', teamRole: 'manager', country: 'FR' });
const TEAM = [THEO, BASILE, JULES, INES];

/** An agency far ahead of the browser: its day is the one the server checks a rate's start against (#290). */
const SETTINGS = {
  timeZone: 'Pacific/Kiritimati',
  slotStartMinute: 0,
  slotLengthMinutes: 360,
  accessMarginMinutes: 15,
};

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}
interface Posted {
  readonly path: string;
  readonly body: unknown;
}

/** The text of an element with its narrow spaces read as spaces: « 30 % » is written with one. */
const text = (element: Element): string => element.textContent.replace(/[\u00a0\u202f]/gu, ' ');

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake `/v1/team`: the list, the presets, the notes, and every POST answered by `post` and kept in `posted`. */
function serve(
  routes: {
    members?: Reply;
    afterPost?: Reply;
    post?: (path: string, body: unknown) => Reply;
    rates?: readonly unknown[];
    shifts?: readonly unknown[];
    planningDown?: boolean;
  } = {},
): Posted[] {
  const posted: Posted[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const path = new URL(input, 'http://localhost').pathname;
      let reply: Reply;
      if (init?.method !== undefined && init.method !== 'GET') {
        const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
        posted.push({ path, body });
        reply = routes.post?.(path, body) ?? { status: 500 };
      } else if (path === '/v1/team/members')
        reply = (posted.length > 0 ? routes.afterPost : undefined) ??
          routes.members ?? { status: 200, body: { members: TEAM } };
      else if (path === '/v1/team/commission-presets') reply = { status: 200, body: { presets: PRESETS } };
      else if (path === '/v1/creators') reply = { status: 200, body: { creators: [LEA] } };
      else if (path === '/v1/scheduling/settings') reply = { status: 200, body: SETTINGS };
      else if (path.endsWith('/commission')) reply = { status: 200, body: { rates: routes.rates ?? [] } };
      else if (path === '/v1/scheduling/planning')
        reply =
          routes.planningDown === true
            ? { status: 503 }
            : {
                status: 200,
                body: {
                  settings: SETTINGS,
                  accounts: [],
                  members: [],
                  shifts: routes.shifts ?? [],
                  conflicts: [],
                },
              };
      else if (path.endsWith('/notes')) reply = { status: 200, body: { notes: [] } };
      else if (path === `/v1/team/members/${THEO.id}`) reply = { status: 200, body: THEO };
      else reply = { status: 404 };
      return Promise.resolve(new Response(JSON.stringify(reply.body ?? null), { status: reply.status }));
    }),
  );
  return posted;
}

/** The page as the app mounts it: the tab and the open member live in the address. */
function renderPage(at = '/equipe/membres', canManage = true, viewerId = id(99)): AnyRouter {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const team = createRoute({
    getParentRoute: () => root,
    path: '/equipe/membres',
    validateSearch: parseTeamSearch,
    component: function Team() {
      const { onglet, membre } = team.useSearch();
      const navigate = team.useNavigate();
      return (
        <MembersPage
          tab={onglet === 'managers' ? 'manager' : 'chatter'}
          selected={membre ?? null}
          canManage={canManage}
          viewerId={viewerId}
          onTab={(tab) =>
            void navigate({ search: (s) => ({ ...s, onglet: tab === 'manager' ? 'managers' : undefined }) })
          }
          onSelect={(memberId) => void navigate({ search: (s) => ({ ...s, membre: memberId ?? undefined }) })}
        />
      );
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([team]),
    history: createMemoryHistory({ initialEntries: [at] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const names = (list: string): string[] =>
  within(screen.getByRole('list', { name: list }))
    .getAllByRole('button')
    .map((row) => row.querySelector('.nv-convo__name')?.firstChild?.textContent ?? '');

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  // Équipe's tabs watch their own width.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  confirmPassword.mockReset();
});

describe('Équipe › Membres', () => {
  it('lists the chatters at work first, folds those who left, and counts each tab', async () => {
    serve();
    renderPage();
    await screen.findByText('2 actifs · 1 absent');
    expect(names('Chatteurs')).toEqual(['Théo', 'Basile']);
    expect(within(screen.getByRole('radio', { name: /Chatteurs/u })).getByText('2')).toBeDefined();
    expect(within(screen.getByRole('radio', { name: /Managers/u })).getByText('1')).toBeDefined();
    expect(names('Partis')).toEqual(['Jules']);
    expect(screen.getAllByText(/Confirmé · 15\s%/u).length).toBeGreaterThan(0);
  });

  it('keeps the managers tab in the address', async () => {
    serve();
    const router = renderPage();
    fireEvent.click(await screen.findByRole('radio', { name: /Managers/u }));
    await waitFor(() => {
      expect(names('Managers')).toEqual(['Inès']);
    });
    expect(router.state.location.search).toEqual({ onglet: 'managers' });
  });

  it('searches by name and says when nobody answers', async () => {
    serve();
    renderPage();
    const search = await screen.findByLabelText('Rechercher un membre');
    fireEvent.change(search, { target: { value: 'basi' } });
    expect(names('Chatteurs')).toEqual(['Basile']);
    fireEvent.change(search, { target: { value: 'Zoé' } });
    expect(screen.getByText('Personne ne répond à « Zoé ».')).toBeDefined();
  });

  it('opens a member on the right, with his rate, his creators and his notes', async () => {
    serve({
      post: () => ({
        status: 201,
        body: { id: id(90), body: 'À suivre', authorName: 'Nora', createdAt: '2026-10-27T10:00:00.000Z' },
      }),
    });
    const router = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /^Théo/u }));
    const sheet = await screen.findByRole('region', { name: 'Théo' });
    expect(router.state.location.search).toEqual({ membre: THEO.id });
    expect(within(sheet).getByText(/Confirmé · depuis le/u)).toBeDefined();
    expect(within(sheet).getByText('Léa')).toBeDefined();
    expect(within(sheet).getByText('Lues par toi et les managers, jamais par Théo.')).toBeDefined();
    // Where his work is, from his record (EQ-11).
    const work = within(sheet).getByRole('navigation', { name: 'Le travail de Théo' });
    expect(
      within(work)
        .getAllByRole('link')
        .map((link) => [link.textContent, link.getAttribute('href')]),
    ).toEqual([
      ['Ses shifts', `/equipe/planning?membre=${THEO.id}`],
      ['Ses rapports', `/equipe/rapports?membre=${THEO.id}`],
      ['Son relevé', `/paie/quinzaine?membre=${THEO.id}`],
    ]);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Fermer la fiche' }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Théo' })).toBeNull();
    });
  });

  it('adds an internal note', async () => {
    const posted = serve({
      post: () => ({
        status: 201,
        body: { id: id(90), body: 'À suivre', authorName: 'Nora', createdAt: '2026-10-27T10:00:00.000Z' },
      }),
    });
    renderPage(`/equipe/membres?membre=${THEO.id}`);
    fireEvent.change(await screen.findByLabelText('Nouvelle note'), { target: { value: '  À suivre  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la note' }));
    await waitFor(() => {
      expect(posted).toEqual([{ path: `/v1/team/members/${THEO.id}/notes`, body: { body: 'À suivre' } }]);
    });
  });

  it('tells a manager whose access changed, not that the server is down', async () => {
    serve({ post: () => ({ status: 403, body: apiError('role_forbidden') }) });
    renderPage(`/equipe/membres?membre=${THEO.id}`);
    fireEvent.change(await screen.findByLabelText('Nouvelle note'), { target: { value: 'À suivre' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter la note' }));
    expect(await screen.findByText('Ton accès à l’équipe a changé. Recharge la page.')).toBeTruthy();
  });

  it('lets a manager read the team, never add a member nor make a link', async () => {
    serve();
    renderPage(`/equipe/membres?membre=${THEO.id}`, false);
    await screen.findByRole('region', { name: 'Théo' });
    expect(screen.queryByRole('button', { name: 'Ajouter un membre' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Lien de nouveau mot de passe' })).toBeNull();
    // Nothing promises him a gesture he does not have.
    expect(screen.getByText(/le propriétaire peut lui créer un lien/u)).toBeDefined();
  });

  it('shows a share of the team’s net on a manager only, never one a former manager kept', async () => {
    const share = { rateBps: 1500, teamShareBps: 300, presetId: null, effectiveFrom: '2026-09-01' };
    const demoted = member(15, { displayName: 'Maël', firstName: 'Maël', commission: share });
    const manager = member(16, {
      displayName: 'Rose',
      firstName: 'Rose',
      teamRole: 'manager',
      commission: share,
    });
    serve({ members: { status: 200, body: { members: [demoted, manager] } } });
    renderPage(`/equipe/membres?membre=${demoted.id}`);
    await screen.findByRole('region', { name: 'Maël' });
    expect(screen.queryByText('Part de l’équipe')).toBeNull();
    cleanup();
    serve({ members: { status: 200, body: { members: [demoted, manager] } } });
    renderPage(`/equipe/membres?onglet=managers&membre=${manager.id}`);
    await screen.findByRole('region', { name: 'Rose' });
    expect(screen.getByText('Part de l’équipe')).toBeDefined();
  });

  it('offers the first member to an empty team, and says when the server does not answer', async () => {
    serve({ members: { status: 200, body: { members: [] } } });
    renderPage();
    expect(await screen.findByText('Ton équipe commence ici')).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Ajouter un membre' })).toHaveLength(1);
    cleanup();
    serve({ members: { status: 503 } });
    renderPage();
    expect(
      await screen.findByText('Le serveur ne répond pas : l’équipe n’a pas pu être lue.', undefined, {
        timeout: 4000,
      }),
    ).toBeDefined();
    // No « Ajouter un membre » above a team that could not be read (EQ-22).
    expect(screen.queryByRole('button', { name: 'Ajouter un membre' })).toBeNull();
  });
});

describe('adding a member', () => {
  const fill = (label: string, value: string): void => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  };
  const open = async (): Promise<void> => {
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter un membre' }));
    await screen.findByRole('dialog', { name: 'Nouveau membre' });
  };
  const who = (): void => {
    fill('Prénom', 'Kofi');
    fill('Nom', 'Agbo');
    fill('E-mail', 'kofi@example.test');
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
  };
  const KOFI = member(20, { displayName: 'Kofi', firstName: 'Kofi', invitationPending: true });

  it('stops a step on what is missing, in words', async () => {
    serve();
    renderPage();
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    expect(screen.getByText('Indique son prénom.')).toBeDefined();
    expect(screen.getByText('Une adresse e-mail complète.')).toBeDefined();
    expect(screen.getByLabelText('Prénom').getAttribute('aria-invalid')).toBe('true');
  });

  it('goes through the three steps, creates the member, then hands over his link', async () => {
    const posted = serve({
      post: (path) =>
        path === '/v1/team/members'
          ? { status: 201, body: KOFI }
          : {
              status: 201,
              body: {
                url: 'https://nirvana.example.test/bienvenue#t=lien-invente-0001',
                expiresAt: '2026-10-30T12:00:00.000Z',
              },
            },
    });
    const router = renderPage();
    await open();
    who();
    // The team name followed the first name; the zone follows the country.
    fireEvent.change(await screen.findByLabelText('Pays'), { target: { value: 'MG' } });
    // The zone named by its city, never its IANA name (EQ-08).
    expect(screen.getByText(/là-bas en ce moment · Antananarivo/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Confirmé/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Léa' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter Kofi' }));

    expect(await screen.findByRole('heading', { name: 'Kofi est dans l’équipe' })).toBeDefined();
    expect(screen.getByLabelText<HTMLInputElement>('Lien à envoyer').value).toBe(
      'https://nirvana.example.test/bienvenue#t=lien-invente-0001',
    );
    expect(posted[0]).toMatchObject({
      path: '/v1/team/members',
      body: {
        email: 'kofi@example.test',
        firstName: 'Kofi',
        displayName: 'Kofi',
        teamRole: 'chatter',
        country: 'MG',
        timeZone: 'Indian/Antananarivo',
        commission: { presetId: PRESET },
        creatorIds: [LEA.id],
        teamShareBps: null,
      },
    });
    expect(posted[1]).toEqual({
      path: `/v1/team/members/${KOFI.id}/invitation-link`,
      body: { purpose: 'invitation' },
    });

    // The gesture expected next comes first: the welcome and the link copied together (EQ-12).
    const copy = screen.getByRole('button', { name: 'Copier le message' });
    expect(document.activeElement).toBe(copy);
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(copy);
    expect(await screen.findByRole('button', { name: 'Message copié' })).toBeDefined();
    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/^Bienvenue dans l’équipe, Kofi ! Choisis ton mot de passe ici : http/u),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Voir sa fiche' }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ membre: KOFI.id });
    });
  });

  it('sends a rate typed by hand under « Autre »', async () => {
    const posted = serve({ post: () => ({ status: 500 }) });
    renderPage();
    await open();
    who();
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Autre/u }));
    fill('Taux à la main', '12,5');
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter Kofi' }));
    expect(await screen.findByText(/Personne n’a été ajouté/u)).toBeDefined();
    expect(posted[0]?.body).toMatchObject({ commission: { rateBps: 1250 } });
  });

  it('takes the owner back to the e-mail when an account already has it', async () => {
    serve({ post: () => ({ status: 409, body: apiError('member_conflict') }) });
    renderPage();
    await open();
    who();
    fireEvent.click(await screen.findByRole('button', { name: 'Continuer' }));
    fireEvent.click(await screen.findByRole('radio', { name: /Confirmé/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter Kofi' }));
    expect(await screen.findByText('Un compte utilise déjà cet e-mail.')).toBeDefined();
    expect(screen.getByLabelText('E-mail').getAttribute('aria-invalid')).toBe('true');
  });
});

describe('changing a member once added (EQ-10)', () => {
  const sheet = async (): Promise<HTMLElement> => {
    renderPage(`/equipe/membres?membre=${THEO.id}`);
    return screen.findByRole('region', { name: 'Théo' });
  };

  it('changes the team name and the creators, sending only what changed', async () => {
    const posted = serve({ post: () => ({ status: 200, body: { ...THEO, displayName: 'Théo M.' } }) });
    fireEvent.click(within(await sheet()).getByRole('button', { name: 'Modifier' }));
    const panel = await screen.findByRole('dialog', { name: 'Modifier Théo' });
    const save = within(panel).getByRole('button', { name: 'Enregistrer' });
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(panel).getByLabelText('Nom dans l’équipe'), { target: { value: 'Théo M.' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Léa', pressed: true }));
    fireEvent.click(save);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(posted).toEqual([
      { path: `/v1/team/members/${THEO.id}`, body: { displayName: 'Théo M.', creatorIds: [] } },
    ]);
  });

  it('gives a new rate from the 1st or the 16th ahead of the agency’s day, chosen by hand, and words a refusal', async () => {
    // 1 November, noon in London: already the 2nd at the agency, so the 1st has gone by and the 16th comes first.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    const posted = serve({ post: () => ({ status: 409, body: apiError('commission_rate_conflict') }) });
    fireEvent.click(within(await sheet()).getByRole('button', { name: 'Changer le taux' }));
    const panel = await screen.findByRole('dialog', { name: 'Changer le taux' });
    const save = within(panel).getByRole('button', { name: 'Enregistrer le taux' });
    // Nothing chosen, neither the rate nor its day: a rate never changes by a stray tap.
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(panel).getByRole('radio', { name: /Confirmé/u }));
    const days = await within(panel).findAllByRole('radio', { name: /\d{4}$/u });
    expect(days.map((day) => day.textContent)).toEqual([
      '16 novembre 2026',
      '1er décembre 2026',
      '16 décembre 2026',
      '1er janvier 2027',
    ]);
    expect(days.some((day) => day.getAttribute('aria-checked') === 'true')).toBe(false);
    expect(save.hasAttribute('disabled')).toBe(true);
    fireEvent.click(days[0] ?? panel);
    expect(save.hasAttribute('disabled')).toBe(false);
    fireEvent.click(save);
    expect(await within(panel).findByText('Ce membre a déjà un taux à partir de ce jour.')).toBeDefined();
    expect(posted).toEqual([
      {
        path: `/v1/team/members/${THEO.id}/commission`,
        body: { commission: { presetId: PRESET }, teamShareBps: null, effectiveFrom: '2026-11-16' },
      },
    ]);
  });

  it('marks a departure only after a confirmation that says what it does', async () => {
    const posted = serve({
      post: () => ({ status: 200, body: { ...THEO, status: 'left', creatorIds: [] } }),
    });
    fireEvent.click(within(await sheet()).getByRole('button', { name: 'Changer le statut' }));
    const panel = await screen.findByRole('dialog', { name: 'Statut de Théo' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Parti' }));
    // A group inside the dialog, not a second modal; the box reads what it confirms.
    const confirm = within(panel).getByRole('group', { name: 'Confirmer le départ' });
    expect(confirm.textContent).toContain('Ce changement est définitif.');
    expect(
      within(confirm).getByRole('checkbox', { description: /Ce changement est définitif\./u }),
    ).toBeDefined();
    const leave = within(panel).getByRole('button', { name: 'Confirmer le départ' });
    expect(leave.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(confirm).getByRole('checkbox'));
    fireEvent.click(leave);
    await waitFor(() => {
      expect(posted).toEqual([{ path: `/v1/team/members/${THEO.id}/status`, body: { status: 'left' } }]);
    });
  });

  it('shows a rate set ahead on the sheet and in the panel, offers the share set last, and says the rate before it is sent', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
    const inForce = { rateBps: 3000, teamShareBps: 300, presetId: null, effectiveFrom: '2026-10-01' };
    const ahead = { rateBps: 4000, teamShareBps: 500, presetId: null, effectiveFrom: '2026-11-16' };
    const rose = member(16, {
      displayName: 'Rose',
      firstName: 'Rose',
      teamRole: 'manager',
      commission: inForce,
    });
    serve({ members: { status: 200, body: { members: [rose] } }, rates: [ahead, inForce] });
    renderPage(`/equipe/membres?membre=${rose.id}`);
    const region = await screen.findByRole('region', { name: 'Rose' });
    expect(await within(region).findByText('40 % à partir du 16 novembre 2026')).toBeDefined();
    fireEvent.click(within(region).getByRole('button', { name: 'Changer le taux' }));
    const panel = await screen.findByRole('dialog', { name: 'Changer le taux' });
    expect(text(panel)).toContain(
      'Aujourd’hui 30 %, depuis le 1er octobre 2026. 40 % prévu à partir du 16 novembre 2026.',
    );
    expect(within(panel).getByLabelText<HTMLInputElement>('Part du net de l’équipe').value).toBe('5');
    expect(within(panel).queryByRole('status')).toBeNull();
    fireEvent.click(within(panel).getByRole('radio', { name: /Autre/u }));
    fireEvent.change(within(panel).getByLabelText('Taux à la main'), { target: { value: '45' } });
    fireEvent.click(within(panel).getByRole('radio', { name: '1er décembre 2026' }));
    // A day that already has a rate is closed and says it.
    const set = within(panel).getByRole('radio', { name: /^16 novembre 2026 · 40\s%\sprévu$/u });
    expect(set.hasAttribute('disabled')).toBe(true);
    expect(text(within(panel).getByRole('status'))).toBe(
      'À partir du 1er décembre 2026 : 45 %, part de l’équipe 5 % (aujourd’hui 30 %). Un taux enregistré ne se modifie plus.',
    );
  });

  it('says what an away status leaves and counts the shifts still on the planning', async () => {
    const shift = (n: number, startsAt: string, memberId: string = THEO.id): unknown => ({
      id: id(60 + n),
      creatorId: LEA.id,
      platformAccountId: id(50),
      memberId,
      startsAt,
      endsAt: new Date(new Date(startsAt).getTime() + 6 * 3_600_000).toISOString(),
      templateId: null,
      stoppedAt: null,
    });
    const soon = (days: number): string => new Date(Date.now() + days * 86_400_000).toISOString();
    serve({
      shifts: [shift(1, soon(1)), shift(2, soon(2)), shift(3, soon(3), BASILE.id)],
    });
    fireEvent.click(within(await sheet()).getByRole('button', { name: 'Changer le statut' }));
    const panel = await screen.findByRole('dialog', { name: 'Statut de Théo' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Suspendu' }));
    expect(panel.textContent).toContain('Théo garde sa connexion et ne voit plus que ses propres shifts');
    const left = await within(panel).findByText(/2 shifts à venir restent au planning/u);
    expect(within(left).getByRole('link', { name: 'Voir ses shifts' }).getAttribute('href')).toBe(
      `/equipe/planning?membre=${THEO.id}`,
    );
    // Gone, the same count sits in the confirmation, beside what Nirvana does not do yet.
    fireEvent.click(within(panel).getByRole('radio', { name: 'Parti' }));
    const confirm = within(panel).getByRole('group', { name: 'Confirmer le départ' });
    expect(await within(confirm).findByText(/2 shifts à venir restent au planning/u)).toBeDefined();
    expect(confirm.textContent).toContain('Son compte membre sur Reveal est à retirer à la main.');
    expect(confirm.textContent).toContain('relevé final');
  });

  it('sends the owner to the planning when his shifts ahead cannot be read', async () => {
    serve({ planningDown: true });
    fireEvent.click(within(await sheet()).getByRole('button', { name: 'Changer le statut' }));
    const panel = await screen.findByRole('dialog', { name: 'Statut de Théo' });
    fireEvent.click(within(panel).getByRole('radio', { name: 'Malade' }));
    const unread = await within(panel).findByText(
      /Ses shifts à venir n’ont pas pu être lus/u,
      {},
      { timeout: 4_000 },
    );
    expect(within(unread).getByRole('link', { name: 'Vérifier au planning' }).getAttribute('href')).toBe(
      `/equipe/planning?membre=${THEO.id}`,
    );
  });

  it('offers nothing to change to a manager', async () => {
    serve();
    renderPage(`/equipe/membres?membre=${THEO.id}`, false);
    const region = await screen.findByRole('region', { name: 'Théo' });
    expect(within(region).queryByRole('button', { name: 'Modifier' })).toBeNull();
    expect(within(region).queryByRole('button', { name: 'Changer le taux' })).toBeNull();
  });
});

describe('a link from the sheet', () => {
  it('asks for the password when the sign-in is old, then makes the link', async () => {
    let calls = 0;
    serve({
      post: () => {
        calls += 1;
        return calls === 1
          ? { status: 403, body: apiError('reauthentication_forbidden') }
          : {
              status: 201,
              body: {
                url: 'https://nirvana.example.test/nouveau-mot-de-passe#t=lien-invente-0002',
                expiresAt: '2026-10-30T12:00:00.000Z',
              },
            };
      },
    });
    confirmPassword.mockResolvedValue('ok');
    renderPage(`/equipe/membres?membre=${THEO.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Lien de nouveau mot de passe' }));
    const password = await screen.findByLabelText('Ton mot de passe');
    fireEvent.change(password, { target: { value: 'mot-de-passe-invente' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer' }));
    expect(await screen.findByLabelText('Lien à envoyer')).toBeDefined();
    expect(confirmPassword).toHaveBeenCalledWith('mot-de-passe-invente');
  });

  it('keeps the link on screen when the list, read again, carries its end', async () => {
    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    serve({
      post: () => ({
        status: 200,
        body: {
          url: 'https://nirvana.example.test/nouveau-mot-de-passe#t=lien-invente-0003',
          expiresAt: until,
        },
      }),
      afterPost: {
        status: 200,
        body: { members: [{ ...THEO, invitationExpiresAt: until }, BASILE, JULES, INES] },
      },
    });
    renderPage(`/equipe/membres?membre=${THEO.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Lien de nouveau mot de passe' }));
    // The list re-read says a link is out; the one just made is still there to send.
    expect(await screen.findByText(/Un lien pour en choisir un nouveau a été créé/u)).toBeDefined();
    expect(screen.getByLabelText('Lien à envoyer')).toBeDefined();
  });

  it('calls « Invité » only one still to choose his password, and offers to replace a live link', async () => {
    const until = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const reset = { ...THEO, invitationExpiresAt: until };
    const invited = member(15, {
      displayName: 'Mialy',
      firstName: 'Mialy',
      invitationPending: true,
      invitationExpiresAt: until,
    });
    serve({ members: { status: 200, body: { members: [reset, invited] } } });
    renderPage(`/equipe/membres?membre=${invited.id}`);
    const list = await screen.findByRole('list', { name: 'Chatteurs' });
    const invitedOf = (name: string): boolean =>
      within(list)
        .getAllByRole('button')
        .find((row) => row.textContent.includes(name))
        ?.textContent.includes('Invité') ?? false;
    expect(invitedOf('Théo')).toBe(false);
    expect(invitedOf('Mialy')).toBe(true);
    expect(screen.getByRole('button', { name: 'Remplacer le lien' })).toBeDefined();
  });

  it('pills only what is not the rule: no « Actif », one « Invité » or « Lien expiré » (EQ-05, EQ-06)', async () => {
    const live = new Date(Date.now() + 2 * 86_400_000).toISOString();
    const dead = new Date(Date.now() - 86_400_000).toISOString();
    const invited = member(15, { displayName: 'Mialy', invitationPending: true, invitationExpiresAt: live });
    const expired = member(16, { displayName: 'Koffi', invitationPending: true, invitationExpiresAt: dead });
    serve({ members: { status: 200, body: { members: [THEO, BASILE, invited, expired] } } });
    renderPage();
    const list = await screen.findByRole('list', { name: 'Chatteurs' });
    const side = (name: string): string =>
      within(list)
        .getAllByRole('button')
        .find((row) => row.querySelector('.nv-convo__name')?.textContent === name)
        ?.querySelector('.nv-convo__side')?.textContent ?? 'none';
    expect(side('Théo')).toBe('');
    expect(side('Basile')).toBe('En congé');
    expect(side('Mialy')).toBe('Invité');
    expect(side('Koffi')).toBe('Lien expiré');
    expect(screen.getByText('3 actifs · 1 absent · 1 invitation en attente · 1 lien expiré')).toBeDefined();
  });

  it('says the member’s city and hour under the name, never an IANA zone (EQ-07, EQ-08)', async () => {
    serve();
    renderPage(`/equipe/membres?membre=${THEO.id}`);
    const sheet = await screen.findByRole('region', { name: 'Théo' });
    expect(sheet.querySelector('.tm-sheet__where')?.textContent).toMatch(/^🇧🇯 Porto-Novo · \d+\sh\s\d{2}$/u);
    expect(sheet.textContent).not.toContain('Africa/');
    expect(sheet.textContent).not.toContain('Chez lui');
    expect(within(sheet).getByText('Dans l’équipe depuis')).toBeDefined();
  });

  it('shows a manager his own record without the notes about him', async () => {
    serve();
    renderPage(`/equipe/membres?onglet=managers&membre=${INES.id}`, false, INES.userId);
    expect(await screen.findByRole('region', { name: 'Inès' })).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Notes internes' })).toBeNull();
  });

  it('opens the fold of those who left when the search finds only them', async () => {
    serve();
    renderPage();
    fireEvent.change(await screen.findByLabelText('Rechercher un membre'), { target: { value: 'jules' } });
    expect(await screen.findByText(/Aucun membre actuel ne répond à « jules »/u)).toBeDefined();
    expect(screen.getByRole('group').hasAttribute('open')).toBe(true);
  });

  it('says why a member who left gets no link', async () => {
    serve({ post: () => ({ status: 409, body: apiError('member_left_conflict') }) });
    renderPage(`/equipe/membres?membre=${BASILE.id}`);
    fireEvent.click(await screen.findByRole('button', { name: 'Lien de nouveau mot de passe' }));
    expect(await screen.findByText('Ce membre est parti : sa fiche ne change plus.')).toBeDefined();
  });
});
