// @vitest-environment jsdom

import { AgencyObjectivesSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { aboutEuros, objectivesSub, objectiveVerdict, ObjectivesCard, wholeEuros } from './Objectives';
import { AGENCY_WEEK, LINA, MAYA } from './fixture';

// Invented figures only (ADR 0092 § 6): two invented creators, invented amounts.
const OBJECTIVES = AgencyObjectivesSchema.parse({
  month: '2026-11-01',
  daysGone: 15,
  days: 30,
  creators: [
    { creatorId: LINA, objectiveMinor: 300_000, revenueMinor: 160_000, projectedMinor: 320_000 },
    { creatorId: MAYA, objectiveMinor: null, revenueMinor: 90_000, projectedMinor: 180_000 },
  ],
  objectiveMinor: 300_000,
  revenueMinor: 250_000,
  projectedMinor: 500_000,
});

const calls: { url: string; init: RequestInit | undefined }[] = [];

function show(canEdit: boolean, objectives = OBJECTIVES): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectivesCard insights={AGENCY_WEEK} objectives={objectives} canEdit={canEdit} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('objectiveVerdict', () => {
  it('says the pace while the month runs, the outcome once it is over', () => {
    expect(objectiveVerdict({ objectiveMinor: null, revenueMinor: 1, projectedMinor: 2 })).toBeNull();
    expect(
      objectiveVerdict({ objectiveMinor: 100_000, revenueMinor: 60_000, projectedMinor: 120_000 })?.tone,
    ).toBe('up');
    const short = objectiveVerdict({ objectiveMinor: 100_000, revenueMinor: 30_000, projectedMinor: 60_000 });
    expect(short?.tone).toBe('down');
    expect(short?.text).toBe('À ce rythme : environ 600\u00a0€, il manquerait environ 400\u00a0€');
    expect(
      objectiveVerdict({ objectiveMinor: 100_000, revenueMinor: 49_900, projectedMinor: 99_800 })?.text,
    ).toBe('À ce rythme : environ 1\u202f000\u00a0€, il manquerait moins de 10\u00a0€');
    expect(
      objectiveVerdict({ objectiveMinor: 100_000, revenueMinor: 100_000, projectedMinor: null }),
    ).toEqual({
      tone: 'up',
      text: 'Objectif atteint',
    });
    expect(
      objectiveVerdict({ objectiveMinor: 100_000, revenueMinor: 40_000, projectedMinor: null })?.text,
    ).toMatch(/^Manqué de/u);
  });
});

describe('the card’s figures', () => {
  it('says what is done in whole euros and a projection to ten euros', () => {
    expect(wholeEuros(161_880)).toBe('1\u202f619\u00a0€');
    expect(aboutEuros(505_875)).toBe('environ 5\u202f060\u00a0€');
    expect(objectivesSub(OBJECTIVES)).toBe('Novembre 2026 · jour 15 sur 30 · interne à l’agence');
    expect(objectivesSub({ ...OBJECTIVES, daysGone: 30 })).toBe(
      'Novembre 2026 · mois terminé · interne à l’agence',
    );
  });
});

describe('ObjectivesCard', () => {
  it('shows the agency first, then each creator, and lets a manager only read', () => {
    show(false);
    expect(screen.getByText('L’agence')).toBeTruthy();
    expect(screen.getByText('Lina Test')).toBeTruthy();
    expect(screen.getByText('Pas d’objectif')).toBeTruthy();
    // How far along, and where the month stands: half of it gone.
    expect(screen.getByRole('img', { name: '53 % de l’objectif, 50 % du mois passé' })).toBeTruthy();
    expect(screen.getByText('L’objectif de l’agence est la somme de ceux fixés.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('lets the owner set an objective in euros, sent in cents', async () => {
    show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Fixer un objectif' }));
    const field = screen.getByRole('textbox', { name: 'Objectif de novembre, en euros' });
    fireEvent.change(field, { target: { value: '2 500,50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.url).toBe(`/v1/dashboard/agency/objectives/${MAYA}/2026-11-01`);
    expect(calls[0]?.init?.method).toBe('PUT');
    expect(calls[0]?.init?.body).toBe(JSON.stringify({ amountMinor: 250_050 }));
  });

  it('never sends an amount it cannot read, and removes with DELETE', async () => {
    show(true);
    fireEvent.click(screen.getByRole('button', { name: 'Modifier l’objectif de Lina Test' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Objectif de novembre, en euros' }), {
      target: { value: 'abc' },
    });
    expect(screen.getByRole('button', { name: 'Enregistrer' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retirer l’objectif' }));
    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.init?.method).toBe('DELETE');
  });
});
