// @vitest-environment jsdom
import { CreatorIdSchema, MeetingTiersBodySchema, type MeetingTierSettings } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingTiersSection } from './MeetingTiersSection';

/* An invented creator and arbitrary durations, chosen only to rise: never the agency's own. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000d7');
const SET: MeetingTierSettings = { newFanHours: 3, closeFanHours: 17, veryCloseFanHours: 41 };

/** A fake `/v1/creators/:id/meeting-tiers` that keeps what it is sent, as the server would. */
function serve(stored: MeetingTierSettings | null): unknown[] {
  let current = stored;
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/v1/creators/${CREATOR}/meeting-tiers`);
      if (init?.method === 'PUT') {
        const body = MeetingTiersBodySchema.parse(
          JSON.parse(typeof init.body === 'string' ? init.body : 'null'),
        );
        puts.push(body);
        current = body.settings;
      }
      return Promise.resolve(new Response(JSON.stringify({ settings: current }), { status: 200 }));
    }),
  );
  return puts;
}

function renderSection(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MeetingTiersSection creatorId={CREATOR} />
    </QueryClientProvider>,
  );
}

const type = (label: string, value: string): void => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
};
const NEW = 'Heures avant de ne plus être nouveau';
const CLOSE = 'Heures avant d’être proche';
const VERY_CLOSE = 'Heures avant d’être très proche';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Compte › Paliers de rencontre (guide 26/11)', () => {
  it('shows empty fields while none is set, no value suggested, and saves the three typed', async () => {
    const puts = serve(null);
    renderSection();
    await screen.findByRole('heading', { name: 'Paliers de rencontre' });
    for (const label of [NEW, CLOSE, VERY_CLOSE]) {
      expect(screen.getByLabelText(label)).toHaveProperty('value', '');
    }
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save.hasAttribute('disabled')).toBe(true);

    type(NEW, '3');
    expect(screen.getByRole('alert').textContent).toBe('Un nombre d’heures par palier, plus que zéro.');
    type(CLOSE, '41');
    type(VERY_CLOSE, '17');
    expect(screen.getByRole('alert').textContent).toBe('Chaque durée est plus longue que la précédente.');
    type(CLOSE, '17');
    type(VERY_CLOSE, '41');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(save);
    expect(await screen.findByText('Paliers de rencontre enregistrés.')).toBeDefined();
    expect(puts).toEqual([{ settings: SET }]);
  });

  it('removes them when the owner empties the three fields', async () => {
    const puts = serve(SET);
    renderSection();
    await waitFor(() => {
      expect(screen.getByLabelText(CLOSE)).toHaveProperty('value', '17');
    });
    for (const label of [NEW, CLOSE, VERY_CLOSE]) type(label, '');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Paliers de rencontre enregistrés.')).toBeDefined();
    expect(puts).toEqual([{ settings: null }]);
  });
});
