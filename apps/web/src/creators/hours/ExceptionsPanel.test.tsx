// @vitest-environment jsdom
import { DEFAULT_AGENT_HOURS, type AgentHours } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExceptionsPanel } from './ExceptionsPanel';

// Everything below is invented (ADR 0010).
const CREATOR = '0192f3a0-0000-7000-8000-0000000000a1';
const BASE = `/v1/creators/${CREATOR}/agent-hours/exceptions`;
/** 9:00 to 1:00 the next day, every day. */
const DAYS: AgentHours = {
  ...DEFAULT_AGENT_HOURS,
  reply: {
    mode: 'slots',
    slots: [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, startMinute: 540, endMinute: 60, enabled: true })),
  },
};

const view = (exceptions: { date: string; ranges: { startMinute: number; endMinute: number }[] }[]) => ({
  exceptions: exceptions.map((exception) => ({
    ...exception,
    updatedBy: 'Charles',
    updatedAt: '2026-11-19T10:00:00.000Z',
  })),
  timeZone: 'Europe/Paris',
  today: '2026-11-20',
});

/** The calls made, answered with `after` for a write and `before` for the read. */
function serve(
  before: ReturnType<typeof view>,
  after: ReturnType<typeof view>,
): { method: string; url: string; body: unknown }[] {
  const calls: { method: string; url: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push({ method, url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
      return Promise.resolve(
        new Response(JSON.stringify(method === 'GET' ? before : after), { status: 200 }),
      );
    }),
  );
  return calls;
}

function show(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ExceptionsPanel creatorId={CREATOR} hours={DAYS} />
    </QueryClientProvider>,
  );
}

const flat = (text: string | null): string => (text ?? '').replace(/\s/gu, ' ');

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Jours modifiés (ADR 0148 § 3)', () => {
  it('lists the days ahead in words, a past one left out, and sets one back', async () => {
    const calls = serve(
      view([
        { date: '2026-11-18', ranges: [] },
        { date: '2026-11-21', ranges: [{ startMinute: 1200, endMinute: 1440 }] },
        { date: '2026-11-24', ranges: [] },
      ]),
      view([{ date: '2026-11-24', ranges: [] }]),
    );
    show();
    const tomorrow = (await screen.findByText('Demain')).closest('li');
    if (tomorrow === null) throw new Error('no line');
    expect(flat(tomorrow.textContent)).toContain('20 h – minuit');
    expect(screen.getByText('Pas d’IA ce jour-là')).toBeDefined();
    expect(screen.queryByText(/18 nov/u)).toBeNull();
    fireEvent.click(within(tomorrow).getByRole('button', { name: 'Rétablir Demain' }));
    await waitFor(() => {
      expect(calls.at(-1)).toEqual({ method: 'DELETE', url: `${BASE}/2026-11-21`, body: null });
    });
    expect(await screen.findByText('Demain suit de nouveau sa semaine type.')).toBeDefined();
  });

  it('turns a day off: no AI that day', async () => {
    const calls = serve(view([]), view([{ date: '2026-11-20', ranges: [] }]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier un jour' }));
    // Two weeks from her Monday, under L M M J V S D: a past day cannot be picked, today is said.
    expect(screen.getByRole('button', { name: 'lundi 16' }).hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByRole('button', { name: 'vendredi 20, aujourd’hui' }).getAttribute('aria-pressed'),
    ).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'lundi 23' }));
    fireEvent.click(screen.getByRole('radio', { name: 'Pas d’IA' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer ce jour' }));
    await waitFor(() => {
      expect(calls.at(-1)).toEqual({ method: 'PUT', url: `${BASE}/2026-11-23`, body: { ranges: [] } });
    });
  });

  it('says plainly what a day opens beyond her week (Sécurité, #865)', async () => {
    serve(view([]), view([]));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier un jour' }));
    // Her day 9 h to midnight is in her week: nothing to say.
    expect(screen.queryByRole('note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une plage' }));
    // 0 h to 4 h: 0 h to 1 h is the night before's slot, 1 h to 4 h is beyond her week.
    expect(flat((await screen.findByRole('note')).textContent)).toBe(
      'Ce jour-là, l’IA répondra aussi de 1 h à 4 h, hors de sa semaine type.',
    );
  });
});
