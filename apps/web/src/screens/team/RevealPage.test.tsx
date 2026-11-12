// @vitest-environment jsdom
import {
  CreatorIdSchema,
  REAUTHENTICATION_ERROR_CODE,
  TeamMemberIdSchema,
  TeamMemberSchema,
  type CreatorId,
  type TeamImportOverview,
  type TeamImportRow,
  type TeamMember,
  type TeamMemberId,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { RevealPage } from './RevealPage';

import { openList, valuesOf } from '@/test/select';

const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mid = (n: number): TeamMemberId => TeamMemberIdSchema.parse(id(n));
const cid = (n: number): CreatorId => CreatorIdSchema.parse(id(n));
const BASE = '/v1/settings/sales-feeds/reveal/team';
const LUNE = cid(11);

/** Every name, e-mail and identifier here is invented (ADR 0010). */
function row(patch: Partial<TeamImportRow>, chatter: Partial<TeamImportRow['chatter']>): TeamImportRow {
  return {
    chatter: {
      platformChatterId: 'c0',
      firstName: 'Ana',
      lastName: 'Test',
      email: 'ana@example.test',
      role: 'chatter',
      isBot: false,
      isExternal: false,
      removedAt: null,
      platformModelIds: [],
      ...chatter,
    },
    link: null,
    dismissedAt: null,
    suggestion: null,
    preselected: false,
    actions: ['link_member', 'link_agent', 'link_none', 'invite', 'dismiss'],
    models: [],
    modelGap: { inImperaOnly: [], onPlatformOnly: [] },
    removal: null,
    ...patch,
  };
}

const LEA = row(
  {
    suggestion: {
      kind: 'member',
      memberId: mid(1),
      memberDisplayName: 'Léa',
      match: 'email',
      departedOn: null,
    },
    preselected: true,
  },
  { platformChatterId: 'c-lea', firstName: 'Léa', email: 'lea@example.test' },
);
const NORA = row(
  {
    suggestion: { kind: 'invite' },
    models: [{ platformModelId: 'm1', handle: 'lune', creatorId: LUNE, creatorDisplayName: 'Lune' }],
  },
  { platformChatterId: 'c-nora', firstName: 'Nora', email: 'nora@example.test', platformModelIds: ['m1'] },
);
const BOT = row(
  { suggestion: { kind: 'none' }, preselected: true, actions: ['link_none', 'dismiss'] },
  { platformChatterId: 'c-bot', firstName: 'Clé', lastName: 'API', email: null, isBot: true },
);
const THEO = row(
  {
    link: { kind: 'member', memberId: mid(2), memberDisplayName: 'Théo' },
    removal: { memberId: mid(2), removedAt: '2026-11-05T12:00:00.000Z', absent: false },
  },
  { platformChatterId: 'c-theo', firstName: 'Théo', email: 'theo@example.test' },
);
const OWN = row(
  { link: { kind: 'member', memberId: mid(3), memberDisplayName: 'Basile' }, actions: [] },
  { platformChatterId: 'c-own', firstName: 'Basile', email: 'basile@example.test' },
);
const ASIDE = row(
  { dismissedAt: '2026-11-06T10:00:00.000Z' },
  { platformChatterId: 'c-aside', firstName: 'Iris', email: 'iris@example.test' },
);

const overview = (rows: TeamImportRow[], patch: Partial<TeamImportOverview> = {}): TeamImportOverview => ({
  rows,
  newCount: 2,
  removalCount: 1,
  abnormalRead: false,
  listError: null,
  ...patch,
});

const member = (n: number, displayName: string): TeamMember =>
  TeamMemberSchema.parse({
    id: id(n),
    userId: id(n + 100),
    email: `m${String(n)}@example.test`,
    firstName: displayName,
    lastName: 'Test',
    displayName,
    teamRole: 'chatter',
    status: 'active',
    country: 'BJ',
    timeZone: 'Africa/Porto-Novo',
    color: null,
    joinedOn: '2026-01-01',
    creatorIds: [],
    commission: null,
    invitationPending: false,
    invitationExpiresAt: null,
  });

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown };
const ok =
  (body: unknown): Handler =>
  () => ({ status: 200, body });
const apiError =
  (status: number, code: string, message: string): Handler =>
  () => ({
    status,
    body: { error: { code, message, details: {}, requestId: 'r' } },
  });

function serve(
  routes: Record<string, Handler>,
): Mock<(url: string, init?: RequestInit) => Promise<Response>> {
  const fetch = vi.fn((url: string, init?: RequestInit) => {
    const handler = routes[`${init?.method ?? 'GET'} ${url}`];
    const { status, body } = handler === undefined ? { status: 404, body: null } : handler(init);
    return Promise.resolve(Response.json(body, { status }));
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

const TEAM = {
  'GET /v1/team/members': ok({ members: [member(1, 'Léa'), member(2, 'Théo'), member(3, 'Basile')] }),
  'GET /v1/team/commission-presets': ok({
    presets: [{ id: id(40), name: 'Débutant', rateBps: 1000, effectiveFrom: '2026-01-01' }],
  }),
  'GET /v1/creators': ok({
    creators: [
      { id: LUNE, displayName: 'Lune', timezone: 'Europe/Paris' },
      { id: id(12), displayName: 'Soleil', timezone: 'Europe/Paris' },
    ],
  }),
};

function renderPage(bounded = false): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/equipe/reveal',
    component: () => (
      <RevealPage platform="reveal" bounded={bounded} ownCreatorIds={[LUNE]} onOpenMember={() => undefined} />
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/equipe/reveal'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const bodyOf = (fetch: ReturnType<typeof serve>, method: string, url: string): unknown => {
  const call = fetch.mock.calls.find(([at, init]) => at === url && init?.method === method);
  const body = call?.[1]?.body;
  return typeof body === 'string' ? JSON.parse(body) : null;
};

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
});

describe('Équipe › Reveal (ADR 0076)', () => {
  it('confirms the ticked rows in one batch, never an invitation, and says a refused row under it', async () => {
    const fetch = serve({
      ...TEAM,
      [`GET ${BASE}`]: ok(overview([LEA, NORA, BOT, THEO])),
      [`POST ${BASE}/links`]: ok({
        results: [
          {
            platformChatterId: 'c-lea',
            ok: false,
            error: { kind: 'not_listed', message: 'Ce compte n’est plus dans la liste de la plateforme' },
          },
          { platformChatterId: 'c-bot', ok: true },
        ],
        overview: overview([LEA, NORA, { ...BOT, link: { kind: 'none' } }, THEO]),
      }),
    });
    renderPage();
    const toConfirm = await screen.findByRole('list', { name: 'Comptes de Reveal à confirmer' });
    expect(within(toConfirm).getByText('Même e-mail')).toBeTruthy();
    expect(screen.getByText('2 nouveaux chatteurs sur Reveal')).toBeTruthy();
    // The invitation is one row at a time: no box to tick, a button instead.
    expect(within(toConfirm).queryByRole('checkbox', { name: 'Confirmer Nora Test' })).toBeNull();
    expect(within(toConfirm).getByRole('button', { name: 'Inviter Nora Test' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la sélection (2)' }));
    await waitFor(() => {
      expect(screen.getByText('Ce compte n’est plus dans la liste de la plateforme.')).toBeTruthy();
    });
    expect(bodyOf(fetch, 'POST', `${BASE}/links`)).toEqual({
      items: [
        { platformChatterId: 'c-lea', link: { kind: 'member', memberId: mid(1) } },
        { platformChatterId: 'c-bot', link: { kind: 'none' } },
      ],
    });
  });

  it('says a removal in amber on its linked row, and leaves a manager’s own row without a gesture', async () => {
    serve({ ...TEAM, [`GET ${BASE}`]: ok(overview([THEO, OWN])) });
    renderPage(true);
    const linked = await screen.findByRole('list', { name: 'Comptes de Reveal reliés' });
    expect(
      within(linked).getByText(/^Retiré de Reveal le 5 nov\., toujours actif chez Impera/u),
    ).toBeTruthy();
    expect(screen.getByText('1 retiré de Reveal, toujours dans l’équipe')).toBeTruthy();
    expect(within(linked).getByRole('combobox', { name: 'Lien de Théo Test' })).toBeTruthy();
    expect(within(linked).queryByRole('combobox', { name: 'Lien de Basile Test' })).toBeNull();
    expect(
      within(linked).getByText('Relié : Basile. Ton propre compte : seul le propriétaire change son lien.'),
    ).toBeTruthy();
  });

  it('offers on a row only what the server allows there', async () => {
    const external = row(
      { actions: ['link_none', 'dismiss'] },
      { platformChatterId: 'c-ext', firstName: 'Max', email: null, isExternal: true },
    );
    serve({ ...TEAM, [`GET ${BASE}`]: ok(overview([external])) });
    renderPage(true);
    const field = await screen.findByRole('combobox', { name: 'Que faire de Max Test' });
    expect(valuesOf(field)).toEqual(['none']);
    expect(screen.getByText('Prestataire')).toBeTruthy();
  });

  it('proposes a departed member on his e-mail, marked as departed, for an account removed from Reveal', async () => {
    const departed = TeamMemberSchema.parse({ ...member(5, 'Hugo'), status: 'left' });
    const removed = row(
      {
        suggestion: {
          kind: 'member',
          memberId: mid(5),
          memberDisplayName: 'Hugo',
          match: 'email',
          departedOn: '2026-11-01',
        },
        actions: ['link_member', 'link_agent', 'link_none', 'dismiss'],
      },
      {
        platformChatterId: 'c-hugo',
        firstName: 'Hugo',
        email: 'm5@example.test',
        removedAt: '2026-11-05T12:00:00.000Z',
      },
    );
    serve({
      ...TEAM,
      'GET /v1/team/members': ok({ members: [member(1, 'Léa'), departed] }),
      [`GET ${BASE}`]: ok(overview([removed], { newCount: 0, removalCount: 0 })),
    });
    renderPage();
    const toConfirm = await screen.findByRole('list', { name: 'Comptes de Reveal à confirmer' });
    expect(within(toConfirm).getByText('Même e-mail · parti le 1er novembre 2026')).toBeTruthy();
    expect(within(toConfirm).getByText('Retiré de Reveal le 5 nov.')).toBeTruthy();
    expect(within(toConfirm).queryByRole('button', { name: 'Inviter Hugo Test' })).toBeNull();
    const box = within(toConfirm).getByRole('checkbox', { name: 'Confirmer Hugo Test' });
    expect(box instanceof HTMLInputElement && box.checked).toBe(false);
    const field = within(toConfirm).getByRole('combobox', { name: 'Que faire de Hugo Test' });
    await waitFor(() => {
      expect(valuesOf(field)).toEqual([`member:${id(1)}`, `member:${id(5)}`, 'agent', 'none']);
    });
    expect(within(openList(field)).getByRole('option', { name: 'Hugo (parti)' })).toBeTruthy();
  });

  it('sets a row aside, and takes one back from the fold', async () => {
    const fetch = serve({
      ...TEAM,
      [`GET ${BASE}`]: ok(overview([LEA, ASIDE])),
      [`PUT ${BASE}/c-lea/dismissal`]: ok(
        overview([{ ...LEA, dismissedAt: '2026-11-07T10:00:00.000Z' }, ASIDE]),
      ),
      [`PUT ${BASE}/c-aside/dismissal`]: ok(overview([LEA, { ...ASIDE, dismissedAt: null }])),
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Écarter Léa Test' }));
    await waitFor(() => {
      expect(bodyOf(fetch, 'PUT', `${BASE}/c-lea/dismissal`)).toEqual({ dismissed: true });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Reprendre Iris Test' }));
    await waitFor(() => {
      expect(bodyOf(fetch, 'PUT', `${BASE}/c-aside/dismissal`)).toEqual({ dismissed: false });
    });
  });

  it('invites one row as a manager: names from Reveal, a chatter at a preset, the password asked again', async () => {
    const fetch = serve({
      ...TEAM,
      [`GET ${BASE}`]: ok(overview([NORA])),
      [`POST ${BASE}/c-nora/invitation`]: apiError(403, REAUTHENTICATION_ERROR_CODE, 'Confirme'),
    });
    renderPage(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Inviter Nora Test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Inviter Nora Test' });
    const email = within(dialog).getByLabelText('E-mail');
    expect(email).toHaveProperty('value', 'nora@example.test');
    expect(email).toHaveProperty('readOnly', true);
    // A manager invites a chatter (ADR 0076 § 3): no role to choose.
    expect(within(dialog).queryByRole('radiogroup', { name: 'Rôle' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuer' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Continuer' }));
    const presets = await within(dialog).findByRole('radiogroup', { name: 'Préréglage de commission' });
    // A preset of the owner's only, never a rate by hand.
    expect(within(presets).queryByRole('radio', { name: /Autre/u })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Inviter Nora' }));
    expect(await within(dialog).findByText('Choisis un préréglage du propriétaire.')).toBeTruthy();
    fireEvent.click(within(presets).getByRole('radio', { name: /Débutant/u }));
    // Her model's creator, in the manager's list, comes ticked.
    expect(within(dialog).getByRole('button', { name: 'Lune' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).queryByRole('button', { name: 'Soleil' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Inviter Nora' }));
    expect(
      await within(dialog).findByText(/^Inviter ouvre un compte qui lira des conversations de fans/u),
    ).toBeTruthy();
    expect(bodyOf(fetch, 'POST', `${BASE}/c-nora/invitation`)).toMatchObject({
      email: 'nora@example.test',
      firstName: 'Nora',
      teamRole: 'chatter',
      commission: { presetId: id(40) },
      teamShareBps: null,
      creatorIds: [LUNE],
    });
  });

  it('says the server’s sentence when the account cannot be invited', async () => {
    serve({
      ...TEAM,
      [`GET ${BASE}`]: ok(overview([NORA])),
      [`POST ${BASE}/c-nora/invitation`]: apiError(
        422,
        'sales_feed_chatter_unprocessable',
        'Ce compte n’est plus dans la liste de la plateforme',
      ),
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Inviter Nora Test' }));
    const dialog = await screen.findByRole('dialog', { name: 'Inviter Nora Test' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Continuer' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Continuer' }));
    fireEvent.click(await within(dialog).findByRole('radio', { name: /Débutant/u }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Inviter Nora' }));
    expect(
      await within(dialog).findByText('Ce compte n’est plus dans la liste de la plateforme'),
    ).toBeTruthy();
  });

  it('says an abnormal reading and a list that did not come, the links staying', async () => {
    serve({
      ...TEAM,
      [`GET ${BASE}`]: ok(overview([THEO], { abnormalRead: true, listError: 'unreachable' })),
    });
    renderPage();
    expect(await screen.findByText(/^La dernière lecture de Reveal est anormale/u)).toBeTruthy();
    expect(screen.getByText(/^Reveal n’a pas renvoyé la liste à jour de son équipe/u)).toBeTruthy();
  });

  it('tells an account that is not the owner’s nor an active manager’s that the review is not here', async () => {
    serve({ [`GET ${BASE}`]: apiError(403, 'role_forbidden', 'Non') });
    renderPage();
    expect(await screen.findByText('Réservé au propriétaire et aux managers actifs')).toBeTruthy();
  });
});
