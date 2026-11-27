// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProgressBand } from './ProgressBand';

/* An invented creator (ADR 0010), Wednesday 4 November 2026. */
const CREATOR = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-000000000001');
const day = (n: number, done: number, ahead = false) => ({
  day: `2026-11-0${String(n + 2)}`,
  essentialsDone: done,
  essentialsAsked: 3,
  done,
  asked: 12,
  ahead,
});
const PROGRESS = {
  week: '2026-11-02',
  today: '2026-11-04',
  days: [day(0, 3), day(1, 2), day(2, 1), day(3, 0, true), day(4, 0, true), day(5, 0, true), day(6, 0, true)],
  shoot: { done: 2, asked: 4 },
  delivery: null,
};

function show(status = 200) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(status === 200 ? Response.json(PROGRESS) : new Response('null', { status })),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProgressBand creatorId={CREATOR} week="2026-11-02" />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ProgressBand (trous béants n° 11)', () => {
  it('reads her week and says the answer first, then each day and her shooting', async () => {
    const fetchMock = show();
    expect(await screen.findByRole('heading', { name: 'Où elle en est' })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(`/v1/creators/${CREATOR}/progress?week=2026-11-02`, {
      credentials: 'include',
    });
    expect(screen.getByText('L’essentiel tenu 1 jour sur 3.')).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('img', { name: 'lun. : essentiel 3 sur 3' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Tournage : 2 sur 4 lignes tournées' })).toBeTruthy();
  });

  it('stays quiet when her week cannot be read (a chatter, a failure)', async () => {
    const fetchMock = show(403);
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(screen.queryByRole('heading', { name: 'Où elle en est' })).toBeNull();
  });
});
