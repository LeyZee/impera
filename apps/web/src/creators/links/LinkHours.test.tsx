// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkHours } from './LinkHours';

/* An invented creator, invented links and counts. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const NOW = new Date('2026-11-26T15:20:00Z');
const STORY = {
  id: '0192f3a0-0000-7000-8000-0000000000e1',
  name: 'Story du jour',
  url: 'https://liens.example.test/nora/story',
  destination: '',
  placement: 'story_daily',
  usageNote: '',
  enabled: true,
  attached: true,
};
const CANAL = {
  ...STORY,
  id: '0192f3a0-0000-7000-8000-0000000000e2',
  name: 'Canal',
  placement: 'telegram_channel',
};
const hour = (linkId: string, hoursAgo: number, clicks: number, robots = 0) => ({
  linkId,
  hour: new Date(Date.parse('2026-11-26T15:00:00Z') - hoursAgo * 3_600_000).toISOString(),
  pageviews: clicks * 2,
  clicks,
  robots,
  closed: hoursAgo > 0,
});

function serve(links: unknown[], hours: unknown[]): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const path = new URL(input, 'http://localhost').pathname;
      return Promise.resolve(new Response(JSON.stringify(path.endsWith('/hours') ? { hours } : { links })));
    }),
  );
}

function renderHours(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LinkHours creatorId={CREATOR} now={NOW} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
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

describe('Trafic › Ses clics, heure par heure (INS-02 lot e3)', () => {
  it('answers first with the clicks of the day against the day before, then ranks her links', async () => {
    serve([STORY, CANAL], [hour(STORY.id, 30, 4), hour(STORY.id, 2, 3, 1), hour(CANAL.id, 1, 5)]);
    renderHours();
    expect(await screen.findByText('contre 4 clics la veille')).toBeDefined();
    expect(screen.getByText('+100 %')).toBeDefined();
    expect(screen.getByRole('group', { name: /^Clics heure par heure sur 24 h/u })).toBeDefined();
    const ranked = within(screen.getByRole('list', { name: 'Clics par lien sur 24 h' })).getAllByRole(
      'listitem',
    );
    expect(ranked.map((row) => row.textContent)).toEqual([
      expect.stringContaining('Canal'),
      expect.stringContaining('Story du jour'),
    ]);
  });

  it('says what to do while no link is linked', async () => {
    serve([{ ...STORY, attached: false }], []);
    renderHours();
    expect(await screen.findByText(/Aucun lien relié pour l’instant/u)).toBeDefined();
  });
});
