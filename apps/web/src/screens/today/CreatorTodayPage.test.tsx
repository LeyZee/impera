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

  it('says nobody answers now, and when the next one starts', async () => {
    serve({ current: [], next: [shift('Théo', '2026-10-28T14:30:00.000Z', '2026-10-28T20:00:00.000Z')] });
    show();
    expect(await screen.findByText('Personne en ce moment. Le prochain commence dans 2 h 30.')).toBeDefined();

    cleanup();
    serve({ current: [], next: [] });
    show();
    expect(await screen.findByText('Personne n’est prévu dans les prochaines 24 heures.')).toBeDefined();
    expect(screen.queryByText(/Ensuite/u)).toBeNull();
  });

  it('says the planning does not load, with a way to try again', async () => {
    serve({}, 500);
    show();
    expect(await screen.findByText(/Le planning n’a pas pu être lu/u)).toBeDefined();
  });
});
