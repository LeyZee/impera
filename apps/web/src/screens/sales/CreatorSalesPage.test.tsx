// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreatorSalesPage } from './CreatorSalesPage';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* Invented fans and messages (ADR 0010). Paris is UTC+1 after 25/10: 12:00Z is 13 h. */
const FAN_A = '0192f3a0-0000-7000-8000-00000000f0a1';
const FAN_B = '0192f3a0-0000-7000-8000-00000000f0b2';
const CONV_A = '0192f3a0-0000-7000-8000-00000000c0a1';

const fans = {
  items: [
    {
      id: FAN_A,
      displayName: 'loup_bleu',
      conversationId: CONV_A,
      spent: { eurMinor: 6400, usdMinor: 0 },
      firstSeenAt: '2026-10-20T10:00:00.000Z',
      lastSeenAt: '2026-11-03T11:48:00.000Z',
    },
    {
      id: FAN_B,
      displayName: 'vince.r',
      conversationId: null,
      spent: { eurMinor: 0, usdMinor: 0 },
      firstSeenAt: '2026-11-03T09:00:00.000Z',
      lastSeenAt: '2026-11-03T09:00:00.000Z',
    },
  ],
  nextCursor: null,
};

const messages = {
  items: [
    {
      id: '0192f3a0-0000-7000-8000-0000000a0002',
      direction: 'outbound',
      text: 'tu vas adorer',
      media: [{ kind: 'image', isLocked: true, description: null }],
      priceMinor: 1500,
      currency: 'EUR',
      isPaid: true,
      platformCreatedAt: '2026-11-03T11:30:00.000Z',
    },
    {
      id: '0192f3a0-0000-7000-8000-0000000a0001',
      direction: 'inbound',
      text: 'salut toi',
      media: [],
      priceMinor: null,
      currency: null,
      isPaid: false,
      platformCreatedAt: '2026-11-03T11:00:00.000Z',
    },
  ],
  nextCursor: null,
};

type Served = Record<string, { status: number; body: unknown }>;

function serve(routes: Served): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn((url: string) => {
    const path = url.split('?')[0] ?? url;
    const route = routes[path];
    return Promise.resolve(
      route === undefined
        ? new Response('null', { status: 404 })
        : new Response(JSON.stringify(route.body), { status: route.status }),
    );
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

const ALL: Served = {
  '/v1/creator-space/fans': { status: 200, body: fans },
  [`/v1/creator-space/conversations/${CONV_A}`]: {
    status: 200,
    body: { id: CONV_A, fan: { id: FAN_A, displayName: 'loup_bleu' } },
  },
  [`/v1/creator-space/conversations/${CONV_A}/messages`]: { status: 200, body: messages },
};

function show(selected: string | null, onSelect = vi.fn()): ReturnType<typeof vi.fn> {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CreatorSalesPage selected={selected} onSelect={onSelect} />
    </QueryClientProvider>,
  );
  return onSelect;
}

/** jsdom has no layout: the reader asks to show its last message, which is checked here. */
const scrollIntoView = vi.fn();

beforeEach(() => {
  scrollIntoView.mockClear();
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-03T12:00:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Ventes, the creator’s (CR-02 c3)', () => {
  it('lists her fans with what each unlocked, and opens a conversation from a fan', async () => {
    serve(ALL);
    const onSelect = show(null);
    const open = await screen.findByRole('button', { name: /loup_bleu/u });
    expect(open.textContent).toContain('vu il y a 12\u00a0min');
    expect(open.textContent).toContain('64\u00a0€');
    // What he paid, not what she earns, until her share is there (reco 20).
    expect(
      screen.getByText(/le prix des messages qu’il a débloqués, TVA comprise, avant parts\./u),
    ).toBeDefined();
    // A fan without a conversation is listed, and opens nothing.
    expect(screen.getByText('vince.r')).toBeDefined();
    expect(screen.queryByRole('button', { name: /vince\.r/u })).toBeNull();
    expect(screen.getByText(/pas encore de conversation/u)).toBeDefined();
    fireEvent.click(open);
    expect(onSelect).toHaveBeenCalledWith(CONV_A);
  });

  it('reads a conversation oldest first, never who wrote it, and nothing in it acts', async () => {
    const fetcher = serve(ALL);
    show(CONV_A);
    const reader = await screen.findByRole('region', { name: 'Conversation avec loup_bleu' });
    expect(await screen.findByText('salut toi')).toBeDefined();
    const bubbles = [...reader.querySelectorAll('.nv-bubble')];
    expect(bubbles.map((bubble) => bubble.className.includes('nv-bubble--fan'))).toEqual([true, false]);
    expect(screen.getByText('Média payant · 15 € · débloqué')).toBeDefined();
    expect(screen.getByText('Lecture seule')).toBeDefined();
    // A screen reader hears who speaks, the side of a bubble being only seen.
    expect(bubbles.map((bubble) => bubble.querySelector('.sr-only')?.textContent)).toEqual([
      'loup_bleu : ',
      'Toi : ',
    ]);
    expect(reader.textContent).not.toMatch(/agent|humain|brouillon|IA/u);
    // Only the way back is a button: no field, no send, no take over.
    expect([...reader.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      '← Tes fans',
    ]);
    expect(reader.querySelector('input, textarea')).toBeNull();
    // Each opening is in the audit log: the conversation is read once, not again in the background.
    const opens = fetcher.mock.calls.filter(([url]) => url === `/v1/creator-space/conversations/${CONV_A}`);
    expect(opens).toHaveLength(1);
    // It opens on the last message, like any messenger.
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('says a conversation that is no longer hers', async () => {
    serve({ '/v1/creator-space/fans': ALL['/v1/creator-space/fans'] ?? { status: 500, body: null } });
    show(CONV_A);
    expect(await screen.findByText('Cette conversation n’est plus disponible.')).toBeDefined();
  });

  it('says her fans do not load, with a way to try again', async () => {
    serve({ '/v1/creator-space/fans': { status: 500, body: null } });
    show(null);
    expect(await screen.findByText(/Tes fans n’ont pas pu être lus/u)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeDefined();
  });

  it('says she has no fan yet', async () => {
    serve({ '/v1/creator-space/fans': { status: 200, body: { items: [], nextCursor: null } } });
    show(null);
    expect(await screen.findByText(/Aucun fan pour l’instant/u)).toBeDefined();
  });
});
