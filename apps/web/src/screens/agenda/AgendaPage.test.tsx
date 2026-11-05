// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgendaPage, type AgendaView } from './AgendaPage';
import { agendaOf, post, shoot, WEDNESDAY } from './fixtures';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* Her agenda, invented (ADR 0010): Wednesday 4 November 2026 at 13 h in Paris (12:00Z). */

interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

function serve(online: () => boolean): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
      if (!online()) return Promise.reject(new TypeError('Failed to fetch'));
      if (url.startsWith('/v1/creator-space/agenda'))
        return Promise.resolve(new Response(JSON.stringify(agendaOf()), { status: 200 }));
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
      if (url === '/v1/creator-space/ticks')
        return Promise.resolve(
          new Response(JSON.stringify({ added: 1, streak: agendaOf().streak }), { status: 200 }),
        );
      return Promise.resolve(new Response('null', { status: 404 }));
    }),
  );
  return calls;
}

function show(view: AgendaView = 'day'): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AgendaPage day={WEDNESDAY} view={view} onDay={() => undefined} onView={() => undefined} />
    </QueryClientProvider>,
  );
}

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
    expect(screen.getByText('Proposé par l’agence')).toBeDefined();
    expect(screen.getByText(/12/u, { selector: '.ag-streak b' })).toBeDefined();
    // Two words only: never « créneau », which belongs to the shifts (ADR 0049).
    expect(document.body.textContent).not.toMatch(/créneau/iu);
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

  it('lists her week, the suggestions without a date first', async () => {
    serve(() => true);
    show('week');
    expect(await screen.findByRole('heading', { name: 'Sans date' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Choisir un moment' })).toBeDefined();
    expect(screen.getAllByText(/Dispo pour l’agence/u).length).toBe(2);
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
    expect(screen.getByRole('radio', { name: 'Mois' })).toBeDefined();
    cleanup();
    show('month');
    expect(await screen.findAllByRole('gridcell')).toHaveLength(42);
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
