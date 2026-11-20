// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AnnouncementsCard } from './AnnouncementsCard';

/* Invented announcements (ADR 0010). Paris is UTC+1 after 25/10. */
const announcement = (id: string, patch: Record<string, unknown> = {}) => ({
  id,
  body: 'Réunion inventée lundi',
  creatorId: null,
  creatorName: null,
  authorName: 'Owner',
  mine: false,
  createdAt: '2026-11-03T09:00:00.000Z',
  readAt: null,
  reads: null,
  ...patch,
});
const A = '0192f3a0-0000-7000-8000-00000000a001';
const B = '0192f3a0-0000-7000-8000-00000000a002';

function serve(list: unknown[], read: { status: number; body: unknown }) {
  const fetcher = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'POST')
      return Promise.resolve(new Response(JSON.stringify(read.body), { status: read.status }));
    return Promise.resolve(new Response(JSON.stringify({ announcements: list }), { status: 200 }));
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AnnouncementsCard zone="Europe/Paris" today="2026-11-03" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Annonces in Aujourd’hui (EQ-12)', () => {
  it('shows what he has not read, says « Lu » once, and keeps it ticked', async () => {
    const fetcher = serve(
      [
        announcement(A, {
          creatorId: '0192f3a0-0000-7000-8000-0000000000c1',
          creatorName: 'Nora',
          body: 'Script inventé',
        }),
        announcement(B, { readAt: '2026-11-03T09:30:00.000Z', body: 'Déjà lue' }),
      ],
      { status: 200, body: { announcementId: A, readAt: '2026-11-03T10:00:00.000Z' } },
    );
    show();
    const item = (await screen.findByText('Script inventé')).closest('li');
    if (item === null) throw new Error('no item');
    expect(within(item).getByText(/À l’équipe de Nora/u)).toBeDefined();
    expect(screen.queryByText('Déjà lue')).toBeNull();
    fireEvent.click(within(item).getByRole('button', { name: 'J’ai lu' }));
    expect(await within(item).findByRole('status')).toBeDefined();
    expect(within(item).queryByRole('button', { name: 'J’ai lu' })).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      `/v1/team/announcements/${A}/read`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('says a refusal in words, and stands nowhere once all are read', async () => {
    serve([announcement(A)], {
      status: 404,
      body: {
        error: {
          code: 'announcement_not_found',
          message: 'Annonce introuvable',
          details: {},
          requestId: 'r',
        },
      },
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'J’ai lu' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Cette annonce a été retirée.');
    cleanup();
    serve([announcement(A, { readAt: '2026-11-03T09:30:00.000Z' }), announcement(B, { mine: true })], {
      status: 200,
      body: null,
    });
    show();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByText('Annonces')).toBeNull();
  });
});
