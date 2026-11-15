// @vitest-environment jsdom
import { CreatorSuggestionSchema, CreatorTaskSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgendaPage, type AgendaView } from './AgendaPage';
import { agendaOf, post, shoot, stretch, WEDNESDAY } from './fixtures';
import { keepSnapshot, rangeKey } from './offline';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* Her agenda, invented (ADR 0010): Wednesday 4 November 2026 at 13 h in Paris (12:00Z). */

/** Who answers her fans on Wednesday, invented: Kofi 14 h – 18 h, Awa 22 h – 2 h, in Paris. */
const SHIFTS = [
  {
    displayName: 'Kofi',
    platform: 'reveal',
    startsAt: '2026-11-04T13:00:00.000Z',
    endsAt: '2026-11-04T17:00:00.000Z',
  },
  {
    displayName: 'Awa',
    platform: 'reveal',
    startsAt: '2026-11-04T21:00:00.000Z',
    endsAt: '2026-11-05T01:00:00.000Z',
  },
];

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

function serve(online: () => boolean, shifts: readonly unknown[] = SHIFTS, agenda = agendaOf()): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (!online()) return Promise.reject(new TypeError('Failed to fetch'));
      if (url.startsWith('/v1/creator-space/agenda'))
        return Promise.resolve(new Response(JSON.stringify(agenda), { status: 200 }));
      if (method === 'PATCH' && url === `/v1/creator-space/tasks/${shoot.id}`) {
        const change: unknown = calls.at(-1)?.body;
        return Promise.resolve(
          new Response(JSON.stringify({ ...shoot, ...(typeof change === 'object' ? change : {}) }), {
            status: 200,
          }),
        );
      }
      if (url === '/v1/scheduling/calendar-link')
        return Promise.resolve(
          method === 'POST'
            ? new Response(
                JSON.stringify({
                  path: `/v1/calendar-feed/${'a'.repeat(43)}.ics`,
                  createdAt: '2026-11-04T12:00:00.000Z',
                }),
                { status: 201 },
              )
            : new Response(JSON.stringify({ link: null }), { status: 200 }),
        );
      if (url.startsWith('/v1/creator-space/shifts'))
        return Promise.resolve(new Response(JSON.stringify({ shifts }), { status: 200 }));
      if (url === '/v1/creator-space/ticks')
        return Promise.resolve(
          new Response(JSON.stringify({ added: 1, streak: agendaOf().streak }), { status: 200 }),
        );
      return Promise.resolve(new Response('null', { status: 404 }));
    }),
  );
  return calls;
}

function show(view: AgendaView = 'day', day: string = WEDNESDAY): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgendaPage day={day} view={view} onDay={() => undefined} onView={() => undefined} />
    </QueryClientProvider>,
  );
}

/** Her agenda's read answered by `answer`, every other door as `serve` answers it. */
function serveAgenda(answer: () => Promise<Response>, agenda = agendaOf()): void {
  serve(() => true, SHIFTS, agenda);
  const others = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) =>
      url.startsWith('/v1/creator-space/agenda') ? answer() : others(url, init),
    ),
  );
}

/** Her phone's copy of the week, read on Tuesday at 21 h. */
const keepYesterday = (agenda = agendaOf()): void => {
  keepSnapshot(rangeKey('2026-11-02', '2026-11-08'), agenda, Date.parse('2026-11-03T20:00:00.000Z'));
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-04T12:00:00Z'));
});

/** A computer's width: Semaine as a grid, Mois. */
function wide(): void {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('min-width'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('Agenda, the creator’s (CR-05)', () => {
  it('shows her day, tasks first: where it stands, where to start, what is next', async () => {
    serve(() => true);
    show();
    expect(await screen.findByText('4 choses à faire')).toBeDefined();
    expect(screen.getByText(/Commence par/u).textContent).toBe('Commence par : 🌿Story du matin');
    expect(screen.getByText(/Ensuite/u).textContent).toMatch(
      /^Ensuite : 🎬Tournage tenue rouge à 14\sh · dans 1\sh$/u,
    );
    expect(screen.getByRole('heading', { name: 'À faire' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Programme' })).toBeDefined();
    expect(screen.getAllByText('Proposé par l’agence').length).toBeGreaterThan(0);
    // The suggestion that found no room is reachable from today, at any width (recette des dates).
    expect(screen.getByRole('heading', { name: 'Sans date' })).toBeDefined();
    expect(screen.getByText(/12/u, { selector: '.ag-streak b' })).toBeDefined();
    // Two words only: never « créneau », which belongs to the shifts (ADR 0049).
    expect(document.body.textContent).not.toMatch(/créneau/iu);
  });

  it('counts in « Programme » her tasks at an hour of the day, not the one carried from yesterday', async () => {
    const late = CreatorTaskSchema.parse({
      ...shoot,
      id: '01936f00-0000-7000-8000-000000000099',
      title: 'Soirée photo',
      when: { kind: 'timed', startsAt: '2026-11-03T22:00:00.000Z', endsAt: '2026-11-04T01:00:00.000Z' },
    });
    serve(() => true, SHIFTS, agendaOf({ tasks: [...agendaOf().tasks, late] }));
    show();
    expect(await screen.findByText('Soirée photo')).toBeDefined();
    expect(screen.getByText('2 tâches à heure')).toBeDefined();
  });

  it('ticks offline, keeps it, and sends it when the network comes back', async () => {
    let online = true;
    const calls = serve(() => online);
    show();
    await screen.findByText('4 choses à faire');
    online = false;
    fireEvent.click(screen.getByRole('button', { name: `Cocher ${post.title}` }));
    expect(await screen.findByRole('button', { name: `Décocher ${post.title}` })).toBeDefined();
    expect(screen.getByText('3 choses à faire')).toBeDefined();
    online = true;
    fireEvent(window, new Event('online'));
    await waitFor(() => {
      expect(
        calls.filter((call) => call.method === 'POST' && call.url === '/v1/creator-space/ticks').length,
      ).toBe(2);
    });
    const sent = calls.filter((call) => call.method === 'POST').at(-1);
    expect(sent?.body).toEqual({
      ticks: [{ taskId: post.id, day: WEDNESDAY, doneAt: '2026-11-04T12:00:00.000Z' }],
    });
    await waitFor(() => {
      expect(localStorage.getItem('impera.agenda.pending')).toBe('[]');
    });
  });

  it('opens offline on her last read of the week', async () => {
    let online = true;
    serve(() => online);
    show();
    await screen.findByText('4 choses à faire');
    cleanup();
    online = false;
    show();
    expect(await screen.findByText('4 choses à faire')).toBeDefined();
  });

  it('says she is offline, and marks the tick that waits for the network (CREA-24)', async () => {
    let online = true;
    serve(() => online);
    show();
    await screen.findByText('4 choses à faire');
    online = false;
    const offline = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent(window, new Event('offline'));
    // Her copy says how old it is (CRE-02).
    expect(
      await screen.findByText(/Hors ligne : tu vois ta dernière lecture, aujourd’hui à 13\sh\./u),
    ).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: `Cocher ${post.title}` }));
    const waiting = await screen.findByRole('button', {
      name: `Décocher ${post.title}, en attente du réseau`,
    });
    expect(waiting.dataset['waiting']).toBe('true');
    expect(screen.getByText(/1 coche partira au retour du réseau/u)).toBeDefined();
    // Back online: sent, and the dot goes.
    offline.mockRestore();
    online = true;
    fireEvent(window, new Event('online'));
    expect(await screen.findByRole('button', { name: `Décocher ${post.title}` })).toBeDefined();
    await waitFor(() => {
      expect(localStorage.getItem('impera.agenda.pending')).toBe('[]');
    });
  });

  it('lists her week, the suggestions without a date first', async () => {
    serve(() => true);
    show('week');
    expect(await screen.findByRole('heading', { name: 'Sans date' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Choisir un moment' })).toBeDefined();
    // Wednesday's, Friday's 22 h – 2 h, and its end on Saturday from 0 h (CREA-02).
    expect(screen.getAllByText(/Dispo pour l’agence/u).length).toBe(3);
    // The shooting sheet of a proposal, folded under its name until she opens it (VEI-01 d).
    const brief = screen.getByText('🎬 Fiche de tournage');
    expect(brief.tagName).toBe('SUMMARY');
    expect(brief.parentElement?.textContent).toContain('Ambiance Nuit, noir et dentelle');
  });

  it('opens a task on its shooting sheet, its lines kept', async () => {
    serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    fireEvent.click(screen.getByRole('button', { name: /^Tournage tenue rouge/u }));
    const sheet = await screen.findByRole('region', { name: 'Fiche de tournage' });
    expect(sheet.querySelector('p')?.textContent).toBe(
      'Tenue rouge, lumière douce\n10 photos, 2 vidéos courtes',
    );
  });

  it('gives her agenda to the calendar of her phone, the address shown once', async () => {
    const calls = serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    fireEvent.click(screen.getByRole('button', { name: /Mon agenda dans mon téléphone/u }));
    expect(await screen.findByRole('dialog', { name: 'Mon agenda dans mon téléphone' })).toBeDefined();
    expect(await screen.findByText(/Tes routines et tes fiches de tournage restent ici/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Créer mon lien' }));
    const shown = await screen.findByLabelText('Ton lien de calendrier');
    expect(shown.textContent).toBe(`http://localhost:3000/v1/calendar-feed/${'a'.repeat(43)}.ics`);
    expect(screen.getByText(/quiconque l’a voit ton agenda/u)).toBeDefined();
    // Shown once: Échap keeps it on the screen until « C’est fait ».
    fireEvent.keyDown(shown, { key: 'Escape' });
    expect(screen.getByLabelText('Ton lien de calendrier')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'C’est fait' }));
    fireEvent.keyDown(await screen.findByText(/Tes routines et tes fiches de tournage restent ici/u), {
      key: 'Escape',
    });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(calls.some((call) => call.method === 'POST' && call.url === '/v1/scheduling/calendar-link')).toBe(
      true,
    );
  });

  it('offers « Une tâche » or « Une dispo » under « Ajouter »', async () => {
    serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    fireEvent.click(screen.getByRole('button', { name: /Ajouter/u }));
    expect(screen.getByRole('radio', { name: 'Une tâche' })).toBeDefined();
    fireEvent.click(screen.getByRole('radio', { name: 'Une dispo' }));
    expect(screen.getByText(/Le temps que tu ouvres à l’agence/u)).toBeDefined();
  });

  it('on a computer, shows her week as a grid of hours and her month', async () => {
    wide();
    serve(() => true);
    show('week');
    expect(
      await screen.findByRole('button', { name: /^Tournage tenue rouge, 14\sh – 16\sh$/u }),
    ).toBeDefined();
    expect(screen.getByText(/Glisse sur une heure libre/u)).toBeDefined();
    // A suggestion with no room has no column of its own: « Sans date » sits above the grid (recette des dates).
    expect(screen.getByRole('heading', { name: 'Sans date' })).toBeDefined();
    expect(screen.getByRole('radio', { name: 'Mois' })).toBeDefined();
    cleanup();
    show('month');
    expect(await screen.findAllByRole('gridcell')).toHaveLength(42);
  });

  it('says who answers her fans under the Programme, a layer she hides on this device (c3)', async () => {
    const calls = serve(() => true);
    show();
    const line = await screen.findByText(/Qui répond à tes fans dans Reveal/u);
    expect(line.textContent).toMatch(
      /^👥 Qui répond à tes fans dans Reveal : Kofi 14\sh – 18\sh, Awa 22\sh – 2\sh$/u,
    );
    // Her days' bounds in her zone: Monday 0 h to the Monday after, in Paris.
    expect(calls.find((call) => call.url.startsWith('/v1/creator-space/shifts'))?.url).toBe(
      '/v1/creator-space/shifts?from=2026-11-01T23%3A00%3A00.000Z&to=2026-11-08T23%3A00%3A00.000Z',
    );
    fireEvent.click(screen.getByRole('button', { name: /Masquer qui répond à tes fans/u }));
    expect(screen.queryByText(/Qui répond à tes fans dans/u)).toBeNull();
    expect(localStorage.getItem('impera.agenda.replies')).toBe('hidden');
    fireEvent.click(screen.getByRole('button', { name: /Voir qui répond à tes fans/u }));
    expect(await screen.findByText(/Qui répond à tes fans dans Reveal/u)).toBeDefined();
  });

  it('shows no switch when nobody is planned on her accounts', async () => {
    serve(() => true, []);
    show();
    await screen.findByText('4 choses à faire');
    expect(screen.queryByRole('button', { name: /qui répond à tes fans/u })).toBeNull();
  });

  it('changes the moment of a task with a button, what a drag does', async () => {
    const calls = serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    fireEvent.click(screen.getByRole('button', { name: /^Tournage tenue rouge/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Changer le moment' }));
    fireEvent.change(screen.getByLabelText('Jour'), { target: { value: '2026-11-05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        when: { kind: 'timed', startsAt: '2026-11-05T13:00:00.000Z', endsAt: '2026-11-05T15:00:00.000Z' },
      });
    });
  });
});

describe('Agenda, recette design du 11/11 (lot B)', () => {
  it('says her copy is being updated while the server is asked (CRE-02)', async () => {
    keepYesterday();
    serveAgenda(() => new Promise<Response>(() => undefined));
    show();
    expect(await screen.findByText('4 choses à faire')).toBeDefined();
    expect(screen.getByText('Mise à jour…')).toBeDefined();
  });

  it('says the server is silent, never « Hors ligne », when it fails with a network, and offers to try again (CRE-02)', async () => {
    keepYesterday();
    serveAgenda(() => Promise.resolve(new Response('{}', { status: 500 })));
    show();
    const silent = await screen.findByText(
      /^Le serveur ne répond pas : tu vois ta dernière lecture, hier à 21\sh\.$/u,
    );
    expect(silent.closest('.ag-offline')).not.toBeNull();
    expect(screen.queryByText(/Hors ligne/u)).toBeNull();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });

  it('titles a day with nothing of hers but a suggestion by the suggestion, and draws no value on the ring (CRE-05, CRE-06)', async () => {
    serve(() => true, SHIFTS, agendaOf({ tasks: [] }));
    show();
    expect(await screen.findByText('1 proposition à regarder')).toBeDefined();
    expect(screen.getByText('Rien d’autre à faire aujourd’hui.')).toBeDefined();
    expect(screen.queryByText('Rien à faire')).toBeNull();
    expect(document.querySelector('.ag-ring .nv-ring__value')).toBeNull();
  });

  it('titles the suggestions of the day like « Sans date », with their count (CRE-07)', async () => {
    const dated = CreatorSuggestionSchema.parse({
      ...agendaOf().suggestions[0],
      id: '01936f00-0000-7000-8000-000000000931',
      when: { kind: 'day', day: WEDNESDAY },
      title: 'Story coulisses',
    });
    serve(() => true, SHIFTS, agendaOf({ suggestions: [...agendaOf().suggestions, dated] }));
    show();
    const heading = await screen.findByRole('heading', { name: 'Proposé pour aujourd’hui' });
    expect(heading.parentElement?.textContent).toBe('Proposé pour aujourd’hui1');
    expect(screen.getByRole('region', { name: 'Proposé pour aujourd’hui' }).textContent).toContain(
      'Story coulisses',
    );
  });

  it('writes a task without a purpose by its title alone: its category is the tag (CRE-19)', async () => {
    serve(() => true);
    show();
    const row = (await screen.findByRole('button', { name: /^Publier le carrousel/u })).closest('li');
    expect(post.purpose).toBeNull();
    expect(row?.querySelector('.ag-task__body')?.textContent).toBe('Publier le carrousel');
    expect(row?.querySelector('.ag-tag')?.textContent).toBe('Publication');
  });

  it('keeps the place of « Aujourd’hui » on today, so that the arrows never move (CRE-20)', async () => {
    serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    expect(screen.queryByRole('button', { name: 'Aujourd’hui' })).toBeNull();
    expect(document.querySelector('.ag-today')).not.toBeNull();
    cleanup();
    show('day', '2026-11-05');
    expect(await screen.findByRole('button', { name: 'Aujourd’hui' })).toBeDefined();
  });

  it('says « Semaine » on a phone as on a computer, and that the month is a computer’s (CRE-21)', async () => {
    serve(() => true);
    show('month');
    expect(await screen.findByRole('radio', { name: 'Semaine' })).toBeDefined();
    expect(screen.queryByRole('radio', { name: 'Ma semaine' })).toBeNull();
    expect(screen.getByText('Le mois se voit sur un ordinateur : voici ta semaine.')).toBeDefined();
  });

  it('ticks a task from its dialog, « Retirer » apart (CRE-23)', async () => {
    const calls = serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    fireEvent.click(screen.getByRole('button', { name: /^Story du matin/u }));
    expect(screen.queryByRole('button', { name: 'OK' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retirer' }).className).toContain('nv-btn--destructive');
    fireEvent.click(screen.getByRole('button', { name: 'C’est fait' }));
    await waitFor(() => {
      expect(calls.find((call) => call.url === '/v1/creator-space/ticks')?.body).toEqual({
        ticks: [{ taskId: stretch.id, day: WEDNESDAY, doneAt: '2026-11-04T12:00:00.000Z' }],
      });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens « Mon agenda dans mon téléphone » in its own column, not in the reel’s phone frame (CRE-17)', async () => {
    serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    fireEvent.click(screen.getByRole('button', { name: /Mon agenda dans mon téléphone/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Mon agenda dans mon téléphone' });
    expect(dialog.querySelector('.ag-callink')).not.toBeNull();
    expect(dialog.querySelector('.ag-phone')).toBeNull();
  });

  it('lets her say why in a field that grows with her text, without the browser’s handle (CRE-30)', async () => {
    serve(() => true);
    show();
    await screen.findByText('4 choses à faire');
    const [decline] = screen.getAllByRole('button', { name: 'Non merci' });
    if (decline === undefined) throw new Error('no « Non merci »');
    fireEvent.click(decline);
    const why = await screen.findByLabelText(/Pourquoi \?/u);
    expect(why.className).toContain('ag-area');
  });
});
