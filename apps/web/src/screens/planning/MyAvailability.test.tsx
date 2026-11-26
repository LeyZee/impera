// @vitest-environment jsdom
import { MemberAvailabilitySchema, SetAvailabilityBodySchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AvailabilityPanel, MyAvailability } from './MyAvailability';

/* An invented member (ADR 0010). */
const WEEK = MemberAvailabilitySchema.parse({
  memberId: '0199f2a0-0000-7000-8000-000000000021',
  weekId: '0199f2a0-0000-7000-8000-000000000301',
  timeZone: 'Indian/Antananarivo',
  ranges: [
    { weekday: 1, startMinute: 18 * 60, endMinute: 24 * 60 },
    { weekday: 2, startMinute: 0, endMinute: 2 * 60 },
  ],
  setAt: '2026-09-01T10:00:00.000Z',
  setByMember: true,
});

function withClient(children: ReactNode): JSX.Element {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function stub(): { method: string; body: unknown }[] {
  const written: { method: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        written.push({ method, body });
        return Promise.resolve(
          new Response(JSON.stringify({ ...WEEK, ranges: SetAvailabilityBodySchema.parse(body).ranges }), {
            status: 201,
          }),
        );
      }
      expect(new URL(input, 'http://localhost').pathname).toBe('/v1/scheduling/availability/mine');
      return Promise.resolve(new Response(JSON.stringify(WEEK), { status: 200 }));
    }),
  );
  return written;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Mes dispos » (ADR 0171, trou 16)', () => {
  it('folds his week a line a day, at his hour, and asks again after a month', async () => {
    stub();
    render(
      withClient(<MyAvailability now={new Date('2026-11-26T10:00:00.000Z')} onEdit={() => undefined} />),
    );
    const week = await screen.findByRole('list', { name: 'Mes dispos de la semaine' });
    expect(within(week).getByText(/^18.h – 2.h$/u)).toBeTruthy();
    expect(screen.getByText(/datent de plus d’un mois/u)).toBeTruthy();
    expect(screen.getByText(/Antananarivo/u)).toBeTruthy();
  });

  it('sends the whole week once: a plage past midnight goes on to the next morning', async () => {
    const written = stub();
    const onClose = vi.fn();
    render(withClient(<AvailabilityPanel week={WEEK} onClose={onClose} />));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une plage le vendredi' }));
    expect(screen.getByRole('group', { name: 'Plage du Vendredi' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer mes dispos' }));
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(written).toHaveLength(1);
    expect(SetAvailabilityBodySchema.parse(written[0]?.body).ranges).toEqual([
      { weekday: 1, startMinute: 18 * 60, endMinute: 24 * 60 },
      { weekday: 2, startMinute: 0, endMinute: 2 * 60 },
      { weekday: 5, startMinute: 18 * 60, endMinute: 22 * 60 },
    ]);
  });

  it('holds back two plages that overlap, and says which day', () => {
    stub();
    render(withClient(<AvailabilityPanel week={WEEK} onClose={() => undefined} />));
    // Monday night runs to 2 h on Tuesday; a Tuesday plage from 1 h runs into it.
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une plage le mardi' }));
    fireEvent.change(screen.getByLabelText('Début de la plage du Mardi'), { target: { value: '1h' } });
    expect(screen.getByText('Deux plages se chevauchent le mardi.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enregistrer mes dispos' })).toHaveProperty('disabled', true);
  });
});
