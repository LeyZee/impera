// @vitest-environment jsdom
import { REAUTHENTICATION_ERROR_CODE, type AiBudget } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BudgetSection } from './BudgetSection';
import { todayOf } from './view';

const BUDGET: AiBudget = {
  dailyCapMinor: 2000,
  trendWatchCapMinor: 100,
  defaults: { dailyCapMinor: 2000, trendWatchCapMinor: 100 },
  isCustom: { dailyCap: false, trendWatchCap: false },
  alertAtMinor: 1600,
  spentTodayMinor: 740,
  trendWatchSpentTodayMinor: 20,
  state: 'ok',
  updatedAt: null,
};

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

/** A fake `/v1/settings/ai-budget`: GET answers `budget`, each PUT is kept in `sent` and answered by `put`. */
function serve(put: (body: unknown) => Reply = () => ({ status: 500 })): unknown[] {
  const sent: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      let reply: Reply = { status: 200, body: BUDGET };
      if (init?.method === 'PUT') {
        const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : 'null');
        sent.push(body);
        reply = put(body);
      }
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return sent;
}

function renderCard(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <BudgetSection />
    </QueryClientProvider>,
  );
}

const flat = (text: string | null): string => (text ?? '').replace(/\s/gu, ' ');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BudgetSection', () => {
  it('shows the budget in force and the day’s spend', async () => {
    serve();
    renderCard();
    expect(await screen.findByText('Budget IA')).toBeTruthy();
    expect(flat(screen.getByText(/^Aujourd/u).textContent)).toBe(
      'Aujourd’hui : 7,40 € dépensés, alerte à 16 €.',
    );
    expect(screen.getAllByText('valeur par défaut')).toHaveLength(2);
  });

  it('warns before saving a budget already spent, then sends the default as null', async () => {
    const sent = serve(() => ({
      status: 200,
      body: {
        ...BUDGET,
        dailyCapMinor: 500,
        isCustom: { dailyCap: true, trendWatchCap: false },
        state: 'reached',
      },
    }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    const daily = screen.getByLabelText('Plafond du jour');
    fireEvent.change(daily, { target: { value: '5' } });
    expect(flat(screen.getByRole('status').textContent)).toBe(
      '7,40 € sont déjà dépensés aujourd’hui : dès l’enregistrement, l’agent s’arrête et les chatteurs prennent le relais jusqu’à minuit.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/^Plafond du jour atteint/u)).toBeTruthy();
    expect(sent).toEqual([{ dailyCapMinor: 500, trendWatchCapMinor: null }]);
  });

  it('refuses a watch cap above the budget and an amount out of bounds, sending nothing', async () => {
    const sent = serve();
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Plafond du jour'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('Plafond de veille'), { target: { value: '3' } });
    expect(screen.getByRole('status').textContent).toMatch(/ne peut pas dépasser/u);
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    fireEvent.change(screen.getByLabelText('Plafond du jour'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(screen.getByLabelText('Plafond du jour').getAttribute('aria-invalid')).toBe('true');
    expect(sent).toEqual([]);
  });

  it('asks for the password and a code when the sign-in is old', async () => {
    serve(() => ({
      status: 403,
      body: {
        error: { code: REAUTHENTICATION_ERROR_CODE, message: 'x', details: {}, requestId: 'r' },
      },
    }));
    renderCard();
    fireEvent.click(await screen.findByRole('button', { name: 'Modifier' }));
    fireEvent.change(screen.getByLabelText('Plafond du jour'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/confirme ton mot de passe et ton code/u)).toBeTruthy();
  });
});

describe('todayOf', () => {
  it('says the alert is passed, against the budget in force', () => {
    const alert: AiBudget = { ...BUDGET, dailyCapMinor: 900, alertAtMinor: 720, state: 'alert' };
    expect(flat(todayOf(alert))).toBe('Alerte passée : 7,40 € dépensés aujourd’hui sur 9 €.');
  });
});
