// @vitest-environment jsdom
import {
  CreateCustomAlertBodySchema,
  CustomAlertBodySchema,
  SetSystemAlertBodySchema,
} from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AlertsSection } from './AlertsSection';

/* Invented creators: no real person. */
const NORA = '0192f3a0-0000-7000-8000-0000000000c1';
const LEA = '0192f3a0-0000-7000-8000-0000000000c2';
const GROUP = '0192f3a0-0000-7000-8000-0000000000a1';
const CREATORS = [
  { id: NORA, displayName: 'Nora Vidal', timezone: 'Europe/Paris' },
  { id: LEA, displayName: 'Léa', timezone: 'Europe/Paris' },
];

const ALERT = {
  groupId: GROUP,
  name: 'Vidéo perso',
  phrase: 'Le fan demande une vidéo faite pour lui',
  keywords: ['vidéo perso', 'custom'],
  pausesAgent: true,
  notify: true,
  creators: [
    { creatorId: NORA, enabled: true, alertId: '0192f3a0-0000-7000-8000-0000000000b1' },
    { creatorId: LEA, enabled: true, alertId: '0192f3a0-0000-7000-8000-0000000000b2' },
  ],
  createdAt: '2026-10-27T10:00:00Z',
  updatedAt: '2026-10-27T10:00:00Z',
};

const SYSTEM = [
  { code: 'keyword', locked: true, creators: [] },
  { code: 'service_request', locked: false, creators: [{ creatorId: LEA, enabled: false }] },
  { code: 'identity_doubt', locked: false, creators: [] },
];

/** Léa has no group for her own alerts; Nora gets everything. */
const OVERVIEW = {
  bots: [],
  routes: [{ creatorId: null, topic: 'urgent', chatId: '0192f3a0-0000-7000-8000-0000000000e1' }],
  coverage: [
    { creatorId: NORA, displayName: 'Nora Vidal', urgentReachable: true, topicsWithoutGroup: [] },
    { creatorId: LEA, displayName: 'Léa', urgentReachable: true, topicsWithoutGroup: ['custom'] },
  ],
  version: 3,
};

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

const apiError = (code: string): unknown => ({
  error: { code, message: code, details: {}, requestId: 'r1' },
});

/** A fake server: each `METHOD url` answered by its route, every call kept in order. */
function serve(routes: Record<string, (body: unknown) => Reply>): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body });
      const route = routes[`${method} ${url}`];
      const reply = route === undefined ? { status: 500 } : route(body);
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const ok = (body: unknown) => (): Reply => ({ status: 200, body });

const BASE = {
  'GET /v1/creators': ok({ creators: CREATORS }),
  'GET /v1/alerts': ok({ custom: [ALERT], system: SYSTEM }),
  'GET /v1/settings/telegram': ok(OVERVIEW),
};

function renderSection(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const rootRoute = createRootRoute();
  const page = createRoute({ getParentRoute: () => rootRoute, path: '/', component: AlertsSection });
  const router = createRouter({
    routeTree: rootRoute.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** An alert's line, opened: one line by alert, the rest shown on a tap (REG-16). */
const line = async (name: string): Promise<HTMLElement> => {
  const title = await screen.findByText(name, { selector: '.al-line__name' });
  const item = title.closest('li');
  if (item === null) throw new Error(`no line for ${name}`);
  const open = item.querySelector('.al-line__open');
  if (open?.getAttribute('aria-expanded') === 'false') fireEvent.click(open);
  return item;
};

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  // jsdom lays nothing out: the editor scrolls to the field to fix, here a no-op.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Réglages › Alertes when it cannot load (P4-01)', () => {
  it('says the server does not answer, and tries again on demand', async () => {
    const calls = serve({ ...BASE, 'GET /v1/alerts': () => ({ status: 503 }) });
    renderSection();
    // The one wording of Réglages for a silent server, then what could not be read (REG-21).
    expect(await screen.findByText('Le serveur ne répond pas')).toBeTruthy();
    expect(screen.getByText('Les alertes n’ont pas pu être lues.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/v1/alerts')).toHaveLength(2);
    });
  });

  it('reads a shape it does not expect as the server not answering, never as a guess', async () => {
    serve({ ...BASE, 'GET /v1/alerts': ok({ custom: [{ name: 'x' }], system: [] }) });
    renderSection();
    expect(await screen.findByText('Le serveur ne répond pas')).toBeTruthy();
  });
});

describe('her own alerts', () => {
  it('shows one line by alert, then what it watches, what it does and where it does not go on Telegram', async () => {
    serve(BASE);
    renderSection();
    const title = await screen.findByText('Vidéo perso', { selector: '.al-line__name' });
    const item = title.closest('li') ?? document.body;
    // Closed: its name, its creators, « Pause », the switch; the phrase and the buttons wait for a tap.
    const open = within(item).getByRole('button', { name: /^Vidéo perso/u, expanded: false });
    expect(within(item).getByText('Pause')).toBeTruthy();
    expect(within(item).queryByRole('button', { name: 'Modifier' })).toBeNull();
    fireEvent.click(open);
    expect(within(item).getByText('Toutes les créatrices')).toBeTruthy();
    expect(within(item).getByText('« Le fan demande une vidéo faite pour lui »')).toBeTruthy();
    expect(
      within(item).getByText('Met l’agent en pause sur ce fan et passe la main à un humain'),
    ).toBeTruthy();
    expect(
      within(item).getByText('Aucun groupe Telegram ne reçoit « Alertes personnalisées » pour Léa'),
    ).toBeTruthy();
    const link = within(item).getByRole('link', { name: 'Choisir le groupe' });
    expect(link.getAttribute('href')).toBe('/reglages/telegram');
  });

  it('says once when Telegram is not plugged in, rather than an error on every line', async () => {
    serve({ ...BASE, 'GET /v1/settings/telegram': () => ({ status: 404 }) });
    renderSection();
    expect(await screen.findByText(/Telegram n’est pas branché sur ce serveur/)).toBeTruthy();
    expect(within(await line('Vidéo perso')).queryByText(/Telegram/)).toBeNull();
  });

  it('says once when no group gets anything yet, and leads to the bots', async () => {
    serve({ ...BASE, 'GET /v1/settings/telegram': ok({ ...OVERVIEW, routes: [] }) });
    renderSection();
    expect(await screen.findByText(/Aucun groupe Telegram ne reçoit encore rien/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Brancher un groupe' }).getAttribute('href')).toBe(
      '/reglages/telegram?onglet=bots',
    );
  });

  it('invites her to write one when she has none', async () => {
    serve({ ...BASE, 'GET /v1/alerts': ok({ custom: [], system: SYSTEM }) });
    renderSection();
    expect(await screen.findByText('Aucune alerte à toi pour l’instant')).toBeTruthy();
  });

  it('creates one under an id made once, so that a retry writes it once', async () => {
    let attempts = 0;
    const calls = serve({
      ...BASE,
      'GET /v1/alerts': ok({ custom: [], system: SYSTEM }),
      'POST /v1/alerts': (body) => {
        attempts += 1;
        if (attempts === 1) return { status: 503 };
        const parsed = CreateCustomAlertBodySchema.parse(body);
        return {
          status: 201,
          body: {
            ...ALERT,
            ...parsed,
            creators: parsed.creators.map((creator, n) => ({
              ...creator,
              alertId: `0192f3a0-0000-7000-8000-0000000000d${String(n)}`,
            })),
          },
        };
      },
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle alerte' }));
    const form = screen.getByRole('form', { name: 'Nouvelle alerte' });

    // Opened on its name; nothing filled: each field says what it lacks, the name takes the focus, nothing is sent.
    expect(document.activeElement).toBe(within(form).getByLabelText('Nom'));
    fireEvent.click(within(form).getByRole('button', { name: 'Créer l’alerte' }));
    expect(within(form).getByText('Donne-lui un nom.')).toBeTruthy();
    expect(
      within(form).getByText('Une phrase, des mots-clés, ou les deux : sinon elle ne surveille rien.'),
    ).toBeTruthy();
    // Every creator is ticked at first; « a phrase, words, or both » marks the phrase too (REG-18).
    expect(within(form).queryByText('Choisis au moins une créatrice.')).toBeNull();
    expect(within(form).getByLabelText('Ce qu’elle repère').getAttribute('aria-invalid')).toBe('true');
    expect(within(form).getByLabelText('Nom').getAttribute('placeholder')).toBe('Ex. : Vidéo perso');
    expect(calls.some((call) => call.method === 'POST')).toBe(false);

    fireEvent.change(within(form).getByLabelText('Nom'), { target: { value: ' Appel ' } });
    const words = within(form).getByLabelText('Mots-clés');
    for (const word of ['appel', 'Appel', 'facetime']) {
      fireEvent.change(words, { target: { value: word } });
      fireEvent.keyDown(words, { key: 'Enter' });
    }
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Nora Vidal' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Créer l’alerte' }));
    expect(await within(form).findByText('Le serveur ne répond pas. Réessaie dans un instant.')).toBeTruthy();

    fireEvent.click(within(form).getByRole('button', { name: 'Créer l’alerte' }));
    await waitFor(() => {
      expect(screen.queryByRole('form', { name: 'Nouvelle alerte' })).toBeNull();
    });
    const posts = calls.filter((call) => call.method === 'POST').map((call) => call.body);
    expect(posts).toHaveLength(2);
    expect(posts[1]).toEqual(posts[0]);
    expect(CreateCustomAlertBodySchema.parse(posts[0])).toMatchObject({
      name: 'Appel',
      phrase: null,
      keywords: ['appel', 'facetime'],
      pausesAgent: false,
      notify: true,
      creators: [{ creatorId: LEA, enabled: true }],
    });
  });

  it('says another active alert already has the name, and keeps the form open to rename it', async () => {
    serve({
      ...BASE,
      'POST /v1/alerts': () => ({ status: 409, body: apiError('custom_alert_name_conflict') }),
    });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle alerte' }));
    const form = screen.getByRole('form', { name: 'Nouvelle alerte' });
    fireEvent.change(within(form).getByLabelText('Nom'), { target: { value: 'vidéo PERSO' } });
    const words = within(form).getByLabelText('Mots-clés');
    fireEvent.change(words, { target: { value: 'custom' } });
    fireEvent.keyDown(words, { key: 'Enter' });
    fireEvent.click(within(form).getByRole('checkbox', { name: 'Nora Vidal' }));
    fireEvent.click(within(form).getByRole('button', { name: 'Créer l’alerte' }));
    expect(await within(form).findByText('Une alerte active porte déjà ce nom.')).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Nouvelle alerte' })).toBeTruthy();
    const name = within(form).getByLabelText('Nom');
    await waitFor(() => {
      expect(document.activeElement).toBe(name);
    });
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(name.closest('[data-invalid="true"]')).not.toBeNull();

    // Renamed: the field is no longer refused.
    fireEvent.change(name, { target: { value: 'Vidéo perso 2' } });
    expect(name.getAttribute('aria-invalid')).toBeNull();
    expect(within(form).queryByText('Une alerte active porte déjà ce nom.')).toBeNull();
  });

  it('edits one in place and sends it whole', async () => {
    const calls = serve({
      ...BASE,
      [`PUT /v1/alerts/${GROUP}`]: (body) => ({
        status: 200,
        body: { ...ALERT, ...CustomAlertBodySchema.parse(body), creators: ALERT.creators },
      }),
    });
    renderSection();
    fireEvent.click(within(await line('Vidéo perso')).getByRole('button', { name: 'Modifier' }));
    const form = screen.getByRole('form', { name: 'Modifier « Vidéo perso »' });
    const save = within(form).getByRole('button', { name: 'Enregistrer' });
    // Nothing changed yet: nothing to save.
    expect(save).toHaveProperty('disabled', true);
    fireEvent.click(within(form).getByRole('switch', { name: /Mettre l’agent en pause/ }));
    fireEvent.click(save);
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true);
    });
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      name: 'Vidéo perso',
      phrase: 'Le fan demande une vidéo faite pour lui',
      keywords: ['vidéo perso', 'custom'],
      pausesAgent: false,
      notify: true,
      creators: [
        { creatorId: NORA, enabled: true },
        { creatorId: LEA, enabled: true },
      ],
    });
  });

  it('says in words why a keyword is refused, a double or one with nothing to match', async () => {
    serve({ ...BASE, 'GET /v1/alerts': ok({ custom: [], system: SYSTEM }) });
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle alerte' }));
    const form = screen.getByRole('form', { name: 'Nouvelle alerte' });
    const words = within(form).getByLabelText('Mots-clés');
    for (const word of ['appel', 'APPEL']) {
      fireEvent.change(words, { target: { value: word } });
      fireEvent.keyDown(words, { key: 'Enter' });
    }
    expect(within(form).getByText('Déjà dans la liste.').getAttribute('role')).toBe('status');
    expect(words.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(words, { target: { value: '!!!' } });
    expect(within(form).queryByText('Déjà dans la liste.')).toBeNull();
    fireEvent.keyDown(words, { key: 'Enter' });
    expect(within(form).getByText('Il faut au moins une lettre ou un chiffre.').getAttribute('role')).toBe(
      'status',
    );
    expect(within(form).queryByText('!!!', { selector: '.ps-entry__text' })).toBeNull();
  });

  it('keeps one editor open at a time, so that no change is dropped without a word', async () => {
    serve(BASE);
    renderSection();
    fireEvent.click(within(await line('Vidéo perso')).getByRole('button', { name: 'Modifier' }));
    expect(screen.getByRole('form', { name: 'Modifier « Vidéo perso »' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Nouvelle alerte' })).toBeNull();
  });

  it('turns one off for all its creators from its line', async () => {
    const calls = serve({
      ...BASE,
      [`PUT /v1/alerts/${GROUP}`]: () => ({ status: 200, body: ALERT }),
    });
    renderSection();
    fireEvent.click(within(await line('Vidéo perso')).getByRole('switch', { name: 'Vidéo perso : active' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true);
    });
    expect(CustomAlertBodySchema.parse(calls.find((call) => call.method === 'PUT')?.body).creators).toEqual([
      { creatorId: NORA, enabled: false },
      { creatorId: LEA, enabled: false },
    ]);
  });

  it('archives one only once confirmed, and says so when it was archived meanwhile', async () => {
    const calls = serve({
      ...BASE,
      [`DELETE /v1/alerts/${GROUP}`]: () => ({ status: 404, body: apiError('custom_alert_not_found') }),
    });
    renderSection();
    const item = await line('Vidéo perso');
    fireEvent.click(within(item).getByRole('button', { name: 'Archiver' }));
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false);
    fireEvent.click(within(item).getByRole('button', { name: 'Garder' }));
    fireEvent.click(within(item).getByRole('button', { name: 'Archiver' }));
    const confirm = within(item)
      .getByText(/Archiver « Vidéo perso » \?/)
      .closest('.nv-confirm');
    if (!(confirm instanceof HTMLElement)) throw new Error('no confirmation');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Archiver' }));
    expect(
      await within(item).findByText('Cette alerte n’existe plus : quelqu’un l’a archivée entre-temps.'),
    ).toBeTruthy();
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
  });
});

describe('the system’s alerts', () => {
  it('leads to each creator’s persona for her words, and names the bot question plainly', async () => {
    serve(BASE);
    renderSection();
    const lede = await screen.findByText(
      'Le code les lève lui-même. Sauf les mots-clés, chacune se coupe créatrice par créatrice.',
    );
    expect(lede).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Persona de Léa' }).getAttribute('href')).toBe(
      `/creatrices?creatrice=${LEA}`,
    );
    expect(screen.getByText('Le fan demande si c’est un bot', { selector: '.al-line__name' })).toBeTruthy();
  });

  it('keeps her persona’s words always on, with no switch', async () => {
    serve(BASE);
    renderSection();
    const item = await line('Mots-clés de la persona');
    expect(within(item).getByText('Toujours active')).toBeTruthy();
    expect(within(item).getByText('Ne se coupe pas ici : un mot se retire dans sa persona.')).toBeTruthy();
    expect(within(item).queryByRole('switch')).toBeNull();
  });

  it('switches one off for one creator, the others as they were', async () => {
    const calls = serve({
      ...BASE,
      'PUT /v1/alerts/system/service_request': (body) => ({
        status: 200,
        body: {
          code: 'service_request',
          locked: false,
          creators: SetSystemAlertBodySchema.parse(body).creators,
        },
      }),
    });
    renderSection();
    const item = await line('Demande de service');
    expect(within(item).getByText('Active pour Nora Vidal')).toBeTruthy();
    fireEvent.click(within(item).getByRole('switch', { name: 'Nora Vidal' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'PUT')).toBe(true);
    });
    expect(calls.find((call) => call.method === 'PUT')?.body).toEqual({
      creators: [{ creatorId: NORA, enabled: false }],
    });
  });

  it('tries the alert as written on a message, and drops the answer once the alert changes', async () => {
    const calls = serve({
      ...BASE,
      'POST /v1/alerts/test': () => ({
        status: 200,
        body: { keywords: ['custom'], phraseMatched: false, reason: null },
      }),
    });
    renderSection();
    fireEvent.click(within(await line('Vidéo perso')).getByRole('button', { name: 'Modifier' }));
    const form = screen.getByRole('form', { name: 'Modifier « Vidéo perso »' });
    const run = within(form).getByRole('button', { name: 'Tester' });
    // Nothing to try on yet.
    expect(run).toHaveProperty('disabled', true);
    expect(within(form).getByText(/un appel au modèle, compté dans le budget du jour/)).toBeTruthy();
    fireEvent.change(within(form).getByLabelText('Message d’un fan'), {
      target: { value: 'une custom stp' },
    });
    fireEvent.click(run);

    const status = within(form).getByRole('status');
    await waitFor(() => {
      expect(status.textContent).toContain('Elle sonnerait, et mettrait l’agent en pause pour ce fan.');
    });
    expect(status.textContent).toContain('Mot-clé trouvé : « custom ».');
    expect(status.textContent).toContain('L’IA ne reconnaît pas la situation de la phrase.');
    expect(calls.find((call) => call.url === '/v1/alerts/test')?.body).toEqual({
      creatorId: NORA,
      alert: { phrase: 'Le fan demande une vidéo faite pour lui', keywords: ['vidéo perso', 'custom'] },
      message: 'une custom stp',
    });
    // Nothing saved by a test.
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);

    fireEvent.change(within(form).getByLabelText('Ce qu’elle repère'), {
      target: { value: 'Le fan veut un appel' },
    });
    expect(status.textContent).toBe('');
  });

  it('reads the phrase with the persona of the creator chosen among the alert’s (recette M13)', async () => {
    const calls = serve({
      ...BASE,
      'POST /v1/alerts/test': () => ({
        status: 200,
        body: { keywords: [], phraseMatched: true, reason: null },
      }),
    });
    renderSection();
    fireEvent.click(within(await line('Vidéo perso')).getByRole('button', { name: 'Modifier' }));
    const form = screen.getByRole('form', { name: 'Modifier « Vidéo perso »' });
    const readers = within(form).getByRole('radiogroup', { name: 'Avec la persona active de' });
    expect(within(readers).getByRole('radio', { name: 'Nora Vidal' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(readers).getByRole('radio', { name: 'Léa' }));
    fireEvent.change(within(form).getByLabelText('Message d’un fan'), { target: { value: 'bonjour' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Tester' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/v1/alerts/test')).toHaveLength(1);
    });
    expect(calls.find((call) => call.url === '/v1/alerts/test')?.body).toMatchObject({ creatorId: LEA });

    // Léa taken off the alert: one creator left, no choice to make, and the test reads Nora's persona.
    fireEvent.click(within(within(form).getByRole('group', { name: 'Créatrices' })).getByText('Léa'));
    expect(within(form).queryByRole('radiogroup', { name: 'Avec la persona active de' })).toBeNull();
    fireEvent.click(within(form).getByRole('button', { name: 'Tester' }));
    await waitFor(() => {
      expect(calls.filter((call) => call.url === '/v1/alerts/test')).toHaveLength(2);
    });
    expect(calls.filter((call) => call.url === '/v1/alerts/test')[1]?.body).toMatchObject({
      creatorId: NORA,
    });
  });

  it('says in amber why the phrase could not be read, and when the server does not answer', async () => {
    let answer: Reply = {
      status: 200,
      body: {
        keywords: [],
        phraseMatched: null,
        reason: 'Le modèle n’a pas pu lire la phrase cette fois : réessaie.',
      },
    };
    serve({ ...BASE, 'POST /v1/alerts/test': () => answer });
    renderSection();
    fireEvent.click(within(await line('Vidéo perso')).getByRole('button', { name: 'Modifier' }));
    const form = screen.getByRole('form', { name: 'Modifier « Vidéo perso »' });
    fireEvent.change(within(form).getByLabelText('Message d’un fan'), { target: { value: 'bonjour' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Tester' }));
    await waitFor(() => {
      expect(within(form).getByRole('status').textContent).toContain('La phrase n’a pas pu être lue.');
    });
    expect(
      within(form).getByText('Le modèle n’a pas pu lire la phrase cette fois : réessaie.').className,
    ).toBe('al-try__warning');

    answer = { status: 500 };
    fireEvent.change(within(form).getByLabelText('Message d’un fan'), { target: { value: 'bonsoir' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Tester' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(
      'Le serveur ne répond pas. Réessaie dans un instant.',
    );
  });
});
