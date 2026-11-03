// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreatorTodayPage } from './CreatorTodayPage';

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

function serve(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) =>
      Promise.resolve(
        url === '/v1/creator-space/on-duty'
          ? new Response(JSON.stringify(body), { status })
          : new Response('null', { status: 404 }),
      ),
    ),
  );
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreatorTodayPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Aujourd’hui, the creator’s (CR-02)', () => {
  it('says who chats for her now, until when, and who takes over', async () => {
    serve({
      current: [shift('Iris', '2026-10-28T11:00:00.000Z', '2026-10-28T17:00:00.000Z')],
      next: [
        shift('Théo', '2026-10-28T17:00:00.000Z', '2026-10-28T23:00:00.000Z'),
        shift('Iris', '2026-10-28T23:00:00.000Z', '2026-10-29T05:00:00.000Z'),
      ],
    });
    show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Iris' })).toBeDefined();
    expect(screen.getByText('En poste')).toBeDefined();
    expect(screen.getByText('encore 5 h')).toBeDefined();
    expect(screen.getByText('12 h – 18 h')).toBeDefined();
    expect(screen.getByRole('progressbar', { name: 'Avancée du shift de Iris' })).toBeDefined();

    const rows = screen.getAllByRole('listitem').map((row) => row.textContent);
    expect(rows).toEqual([
      nb('Théo@noraAujourd’hui · 18 h – 0 hdans 5 h'),
      nb('Iris@noraDemain · 0 h – 6 hdans 11 h'),
    ]);
  });

  it('says nobody is on shift, and when the next one starts', async () => {
    serve({ current: [], next: [shift('Théo', '2026-10-28T14:30:00.000Z', '2026-10-28T20:00:00.000Z')] });
    show();
    expect(await screen.findByText('Pas de shift en ce moment')).toBeDefined();
    expect(screen.getByText('Le prochain commence dans 2 h 30.')).toBeDefined();

    cleanup();
    serve({ current: [], next: [] });
    show();
    expect(await screen.findByText('Aucun shift n’est prévu dans les prochaines 24 heures.')).toBeDefined();
    expect(screen.queryByText('Ensuite')).toBeNull();
  });

  it('says the planning does not load, with a way to try again', async () => {
    serve({}, 500);
    show();
    expect(await screen.findByText(/Le planning n’a pas pu être lu/u)).toBeDefined();
  });
});
