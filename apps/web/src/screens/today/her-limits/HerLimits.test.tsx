// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HerLimits } from './HerLimits';

/* Invented creator (ADR 0010). */
const LIMITS = {
  creatorId: '00000000-0000-4000-8000-0000000000c1',
  today: '2026-11-21',
  absences: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      startsOn: '2026-11-24',
      endsOn: '2026-11-26',
      note: 'Voyage',
      createdAt: '2026-11-20T10:00:00.000Z',
    },
  ],
  stops: [
    {
      id: '00000000-0000-4000-8000-0000000000a1',
      what: 'les vidéos en extérieur',
      createdAt: '2026-11-20T10:00:00.000Z',
    },
  ],
};

function show() {
  const fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === 'POST'
        ? new Response(JSON.stringify({}), { status: 201 })
        : url === '/v1/creator-space/limits'
          ? Response.json(LIMITS)
          : new Response('null', { status: 404 }),
    ),
  );
  vi.stubGlobal('fetch', fetchMock);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <HerLimits today="2026-11-21" />
    </QueryClientProvider>,
  );
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Prévenir l’agence » (Charles, 21/11)', () => {
  it('lists what she told, with a way to take each back', async () => {
    show();
    expect(await screen.findByText(/^Absente du mar\. 24 nov\./u)).toBeDefined();
    expect(screen.getByText('les vidéos en extérieur')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Je le refais' })).toBeDefined();
  });

  it('sends what she no longer does, in her words, once', async () => {
    const fetchMock = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Je ne fais plus quelque chose' }));
    const send = screen.getByRole<HTMLButtonElement>('button', { name: 'Prévenir' });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Ce que tu ne fais plus'), { target: { value: 'les pieds' } });
    fireEvent.click(send);
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => url === '/v1/creator-space/stops')).toBe(true);
    });
    const call = fetchMock.mock.calls.find(([url]) => url === '/v1/creator-space/stops');
    const sent = call?.[1]?.body;
    expect(typeof sent === 'string' ? JSON.parse(sent) : null).toMatchObject({ what: 'les pieds' });
    expect(await screen.findByRole('status')).toBeDefined();
  });

  it('opens her absence on tomorrow, both days included', async () => {
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Je serai absente' }));
    expect(screen.getByLabelText<HTMLInputElement>('Du').value).toBe('22/11/2026');
    expect(screen.getByLabelText('Au (inclus)')).toBeDefined();
  });
});
