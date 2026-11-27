// @vitest-environment jsdom
import { CreatorIdSchema, MeetingTiersBodySchema, type MeetingTierSettings } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MeetingTiersSection } from './MeetingTiersSection';

/* An invented creator and arbitrary durations, chosen only to rise: never the agency's own. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000d7');
// 3 days, 2 weeks, 5 months, in hours.
const SET: MeetingTierSettings = { newFanHours: 72, closeFanHours: 336, veryCloseFanHours: 3_600 };

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
const NEW = 'Plus nouveau après';
const CLOSE = 'Proche après';
const VERY_CLOSE = 'Très proche après';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const unit = (field: string, name: string): void => {
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: `Unité : ${field}` })).getByRole('radio', { name }),
  );
};

describe('Créatrices › Compte › Paliers de rencontre (guide 26/11)', () => {
  it('shows empty fields in days, weeks and months while none is set, and saves them in hours', async () => {
    const puts = serve(null);
    renderSection();
    await screen.findByRole('heading', { name: 'Paliers de rencontre' });
    for (const label of [NEW, CLOSE, VERY_CLOSE]) {
      expect(screen.getByLabelText(label)).toHaveProperty('value', '');
    }
    const checked = (field: string) =>
      within(screen.getByRole('radiogroup', { name: `Unité : ${field}` }))
        .getAllByRole('radio')
        .find((radio) => radio.getAttribute('aria-checked') === 'true')?.textContent;
    expect([checked(NEW), checked(CLOSE), checked(VERY_CLOSE)]).toEqual(['jours', 'semaines', 'mois']);
    expect(screen.getByText('Pas encore réglé')).toBeDefined();
    const save = screen.getByRole('button', { name: 'Enregistrer' });
    expect(save.hasAttribute('disabled')).toBe(true);

    type(NEW, '3');
    expect(screen.getByRole('alert').textContent).toBe(
      'Indique dans chaque champ une durée plus grande que zéro.',
    );
    // 3 days, then 2 days: shorter once converted.
    type(CLOSE, '2');
    unit(CLOSE, 'jours');
    type(VERY_CLOSE, '5');
    expect(screen.getByRole('alert').textContent).toBe(
      'Chaque durée doit être plus longue que la précédente.',
    );
    unit(CLOSE, 'semaines');
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(save);
    expect(await screen.findByText('Paliers de rencontre enregistrés.')).toBeDefined();
    expect(puts).toEqual([{ settings: SET }]);
    // Saved: the line that said it was never set is gone.
    await waitFor(() => {
      expect(screen.queryByText('Pas encore réglé')).toBeNull();
    });
  });

  it('shows stored hours in the largest unit that falls exactly, and removes them when emptied', async () => {
    const puts = serve(SET);
    renderSection();
    await waitFor(() => {
      expect(screen.getByLabelText(CLOSE)).toHaveProperty('value', '2');
    });
    expect(screen.getByLabelText(VERY_CLOSE)).toHaveProperty('value', '5');
    expect(screen.queryByText('Pas encore réglé')).toBeNull();
    for (const label of [NEW, CLOSE, VERY_CLOSE]) type(label, '');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Paliers de rencontre enregistrés.')).toBeDefined();
    expect(puts).toEqual([{ settings: null }]);
  });
});
