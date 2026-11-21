// @vitest-environment jsdom
import { DROP_CATEGORY_LABELS } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreatorTodayPage } from './CreatorTodayPage';

import { agendaOf } from '@/screens/agenda/fixtures';
import { keepSnapshot, rangeKey } from '@/screens/agenda/offline';
import { requestOf } from '@/screens/content/fixtures';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* Invented members and account (ADR 0010). Paris is UTC+1 after 25/10: 12:00Z is 13 h. */
const shift = (displayName: string, startsAt: string, endsAt: string) => ({
  displayName,
  handle: 'nora',
  startsAt,
  endsAt,
});

/** Text as the screen writes it, a number and its unit held together (« 5 h »); the queries by text read it with spaces. */
const nb = (text: string): string =>
  text.replace(/(\d) (h|min)/gu, '$1\u00a0$2').replace(/h (\d)/gu, 'h\u00a0$1');

function serve(body: unknown, status = 200, agenda: unknown = null, content: unknown = null): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/v1/creator-space/on-duty'
          ? new Response(JSON.stringify(body), { status })
          : url.startsWith('/v1/creator-space/agenda?') && agenda !== null
            ? new Response(JSON.stringify(agenda), { status: 200 })
            : url === '/v1/creator-space/content' && content !== null
              ? Response.json(content)
              : new Response('null', { status: 404 }),
      ),
    ),
  );
}

function show(): void {
  const root = createRootRoute({ component: Outlet });
  const page = createRoute({ getParentRoute: () => root, path: '/', component: CreatorTodayPage });
  const agenda = createRoute({ getParentRoute: () => root, path: '/agenda', component: () => null });
  const content = createRoute({ getParentRoute: () => root, path: '/contenu', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, agenda, content]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Aujourd’hui, the creator’s (CR-02)', () => {
  it('names what the agency asked her that is due today or late, the late first, and « Déposer » opens it (CRE-01)', async () => {
    serve({ current: [], next: [] }, 200, null, {
      requests: [
        requestOf({ dueOn: '2026-10-30', reason: 'Pour vendredi' }),
        requestOf({ dueOn: '2026-10-28', category: 'reveal_story', reason: 'Pour ce soir' }),
        requestOf({ dueOn: '2026-10-25', reason: 'La séance promise' }),
      ],
      drops: [],
    });
    show();
    const card = (await screen.findByRole('heading', { level: 2, name: 'À envoyer' })).closest('section');
    if (card === null) throw new Error('no card');
    const lines = [...card.querySelectorAll('.sc-send__line')].map((line) => line.textContent);
    expect(lines).toEqual([
      `📸${DROP_CATEGORY_LABELS.feed_shoot}En retard depuis dim. 25 oct.`,
      `✨${DROP_CATEGORY_LABELS.reveal_story}Pour aujourd’hui`,
    ]);
    expect(card.querySelector('.sc-send__due--late')?.textContent).toBe('En retard depuis dim. 25 oct.');
    const go = screen.getByRole('link', { name: 'Déposer la première' });
    expect(go.className).toContain('nv-btn--neon');
    expect(go.getAttribute('href')).toMatch(/^\/contenu\?demande=/u);
  });

  it('puts what waits on her answer on top, and sends her answer (ADR 0164)', async () => {
    const decision = {
      id: '01936f00-0000-7000-8000-000000000001',
      kind: 'publish_time',
      category: 'post',
      question: 'Je publie ton Reel à 18 h 30 ?',
      context: 'C’est l’heure où tes abonnés sont le plus là.',
      layout: 'buttons',
      answers: [
        { key: 'yes', label: 'Oui, à 18 h 30', text: null, noted: 'Je publie à 18 h 30.' },
        { key: 'change', label: 'Changer l’heure', text: null, noted: 'On change l’heure.' },
      ],
      otherIdeasLeft: 0,
    };
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url === '/v1/creator-space/decisions')
          return Promise.resolve(Response.json({ decisions: sent.length === 0 ? [decision] : [] }));
        if (url === `/v1/creator-space/decisions/${decision.id}/answer`) {
          sent.push(typeof init?.body === 'string' ? init.body : '');
          return Promise.resolve(Response.json({ noted: 'Je publie à 18 h 30.' }));
        }
        return Promise.resolve(
          url === '/v1/creator-space/on-duty'
            ? Response.json({ current: [], next: [] })
            : new Response('null', { status: 404 }),
        );
      }),
    );
    show();
    const question = await screen.findByRole('heading', { level: 2, name: decision.question });
    const cards = [...document.querySelectorAll('.sc-today > *')];
    expect(cards[0]?.contains(question)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Oui, à 18 h 30' }));
    expect(await screen.findByText('Je publie à 18 h 30.')).toBeTruthy();
    expect(sent).toEqual([JSON.stringify({ answer: 'yes' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }));
    await waitFor(() => {
      expect(screen.queryByText('À décider')).toBeNull();
    });
  });

  it('says nothing of her content while nothing is due', async () => {
    serve({ current: [], next: [] }, 200, null, {
      requests: [requestOf({ dueOn: '2026-10-30', reason: 'Pour vendredi' })],
      drops: [],
    });
    show();
    await screen.findByRole('heading', { level: 2, name: 'Qui répond à tes fans' });
    await waitFor(() => {
      expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/v1/creator-space/content')).toBe(true);
    });
    expect(screen.queryByRole('heading', { name: 'À envoyer' })).toBeNull();
  });

  it('says in one quiet card who answers her fans now, and who takes over', async () => {
    serve({
      current: [shift('Iris', '2026-10-28T11:00:00.000Z', '2026-10-28T17:00:00.000Z')],
      next: [
        shift('Théo', '2026-10-28T17:00:00.000Z', '2026-10-28T23:00:00.000Z'),
        shift('Iris', '2026-10-28T23:00:00.000Z', '2026-10-29T05:00:00.000Z'),
      ],
    });
    show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Qui répond à tes fans' })).toBeDefined();
    const lines = [...document.querySelectorAll('.sc-fans__line')].map((line) => line.textContent);
    expect(lines).toEqual([
      nb('En ce moment : Iris jusqu’à 18 h.'),
      nb('Ensuite : Théo aujourd’hui 18 h – 0 h, Iris demain 0 h – 6 h.'),
    ]);
    // One account goes without saying; no gauge, no hero: the chatter is never the point of her day.
    expect(screen.queryByText(/@nora/u)).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('names her account when several are on shift for her', async () => {
    serve({
      current: [shift('Iris', '2026-10-28T11:00:00.000Z', '2026-10-28T17:00:00.000Z')],
      next: [
        { ...shift('Théo', '2026-10-28T17:00:00.000Z', '2026-10-28T23:00:00.000Z'), handle: 'nora_vip' },
      ],
    });
    show();
    expect(await screen.findByText(/sur @nora_vip/u)).toBeDefined();
    expect(screen.getByText(/sur @nora$/u)).toBeDefined();
  });

  it('says nobody answers now in one sentence: who starts, when, and until when (CREA-26)', async () => {
    serve({
      current: [],
      next: [
        shift('Théo', '2026-10-28T14:30:00.000Z', '2026-10-28T20:00:00.000Z'),
        shift('Iris', '2026-10-28T23:00:00.000Z', '2026-10-29T05:00:00.000Z'),
      ],
    });
    show();
    await screen.findByText('Théo');
    const lines = [...document.querySelectorAll('.sc-fans__line')].map((line) => line.textContent);
    // Théo is said once: the next line only has who comes after him.
    expect(lines).toEqual([
      nb('Théo à partir de 15 h 30 (dans 2 h 30), jusqu’à 21 h.'),
      nb('Ensuite : Iris demain 0 h – 6 h.'),
    ]);

    cleanup();
    serve({ current: [], next: [shift('Théo', '2026-10-29T08:00:00.000Z', '2026-10-29T12:00:00.000Z')] });
    show();
    await screen.findByText('Théo');
    expect(document.querySelector('.sc-fans__line')?.textContent).toBe(
      nb('Théo demain à partir de 9 h (dans 20 h), jusqu’à 13 h.'),
    );

    cleanup();
    serve({ current: [], next: [] });
    show();
    expect(await screen.findByText('Personne n’est prévu dans les prochaines 24 heures.')).toBeDefined();
    expect(screen.queryByText(/Ensuite/u)).toBeNull();
  });

  it('says the planning does not load, with a way to try again', async () => {
    serve({}, 500);
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });
});

describe('Aujourd’hui, her day (CREA-19)', () => {
  beforeEach(() => {
    // Wednesday 4 November, 9 h 10 in Paris: the week of the fixtures.
    vi.setSystemTime(new Date('2026-11-04T08:10:00Z'));
  });

  it('opens on where her day stands, what to start with, what is next, and the way into Agenda', async () => {
    serve({ current: [], next: [] }, 200, agendaOf());
    show();
    expect(await screen.findByText('4 choses à faire')).toBeDefined();
    expect(screen.getByText('Story du matin')).toBeDefined();
    expect(screen.getByText(/Ensuite :/u).textContent).toContain('Tournage tenue rouge');
    expect(screen.getByRole('link', { name: 'Ouvrir l’agenda' }).getAttribute('href')).toBe('/agenda');
  });

  it('puts what she owes first, and never calls an empty agenda a day off while she owes (CRE-01)', async () => {
    serve({ current: [], next: [] }, 200, agendaOf({ tasks: [], suggestions: [] }), {
      requests: [requestOf({ dueOn: '2026-11-01', reason: 'La séance promise' })],
      drops: [],
    });
    show();
    expect(await screen.findByText('Rien à l’agenda')).toBeDefined();
    expect(screen.queryByText('Profite de ta journée.')).toBeNull();
    const send = (await screen.findByRole('heading', { level: 2, name: 'À envoyer' })).closest('section');
    const day = screen.getByRole('region', { name: 'Ta journée' });
    expect(send?.compareDocumentPosition(day)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // One request alone: the button needs no ordinal.
    expect(screen.getByRole('link', { name: 'Déposer' })).toBeDefined();
  });

  it('counts what the agency waits on her for, and takes her to her week to answer', async () => {
    serve({ current: [], next: [] }, 200, agendaOf());
    show();
    expect(await screen.findByRole('heading', { name: 'À décider' })).toBeDefined();
    // The week's number, saying how many are today's: the glance above counts today's (CRE-05).
    expect(
      screen.getByText(
        '2 propositions de l’agence attendent ta réponse cette semaine, dont 1 pour aujourd’hui.',
      ),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Voir' }).getAttribute('href')).toBe('/agenda?vue=semaine');

    cleanup();
    localStorage.clear();
    serve({ current: [], next: [] }, 200, agendaOf({ suggestions: [] }));
    show();
    await screen.findByText('4 choses à faire');
    expect(screen.queryByRole('heading', { name: 'À décider' })).toBeNull();
  });

  it('keeps who answers her fans when her agenda cannot be read', async () => {
    serve({ current: [], next: [] });
    show();
    expect((await screen.findByRole('alert')).textContent).toContain('Le serveur ne répond pas');
    expect(screen.getByText('Personne n’est prévu dans les prochaines 24 heures.')).toBeDefined();
  });
});

describe('Aujourd’hui, her kept copy (CRE-02)', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-11-04T08:10:00Z'));
    // Her phone's copy of the week, read on Tuesday at 21 h: nothing to do then.
    keepSnapshot(
      rangeKey('2026-11-02', '2026-11-08'),
      agendaOf({ tasks: [], suggestions: [] }),
      Date.parse('2026-11-03T20:00:00.000Z'),
    );
  });

  it('says the copy is being updated while the server is asked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        url.startsWith('/v1/creator-space/agenda?')
          ? new Promise<Response>(() => undefined)
          : Promise.resolve(new Response(JSON.stringify({ current: [], next: [] }), { status: 200 })),
      ),
    );
    show();
    expect(await screen.findByText('Rien à faire')).toBeDefined();
    expect(screen.getByText('Mise à jour…')).toBeDefined();
  });

  it('says the server is silent, with the copy’s age and « Réessayer », never silently', async () => {
    serve({ current: [], next: [] }, 200, null);
    show();
    expect(await screen.findByText(/^Tu vois ta dernière lecture, hier à 21\sh\.$/u)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
    expect(screen.queryByText(/Hors ligne/u)).toBeNull();
  });
});
