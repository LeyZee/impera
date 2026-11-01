// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayRulesSection } from './PayRulesSection';

import { SCHEDULING_SETTINGS } from '@/test/pay';

/* Invented creators and accounts (ADR 0010); the rates are examples, not anyone's. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const account = (n: number, creatorName: string, handle: string) => ({
  id: id(10 + n),
  creatorId: id(n),
  creatorName,
  platform: 'reveal',
  handle,
});
const rules = (n: number, accountN: number, fromPeriod: string, patch: Record<string, unknown> = {}) => ({
  id: id(500 + n),
  platformAccountId: id(10 + accountN),
  creatorId: id(accountN),
  fromPeriod,
  currency: 'EUR',
  vatBps: 2_000,
  platformFeeBps: 1_500,
  earningsSource: 'declared',
  createdAt: '2026-10-01T00:00:00.000Z',
  ...patch,
});

let answer: { status: number; body: unknown };
let settings: Record<string, unknown>;
let accounts: unknown[] | null = null;
const writes: { path: string; body: unknown }[] = [];
/** What a write waits for before it is answered: resolved, unless a test holds the answer back. */
let gate: Promise<void> = Promise.resolve();

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST' || init?.method === 'PUT') {
        writes.push({
          path: url.pathname,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        });
        const { body, status } = answer;
        return gate.then(() => json(body, status));
      }
      if (url.pathname === '/v1/payroll/settings') return json(settings);
      if (url.pathname === '/v1/scheduling/settings') return json(SCHEDULING_SETTINGS);
      if (url.pathname === '/v1/team/pay-rules') {
        return json({
          currentPeriod: '2026-10-16',
          accounts: accounts ?? [
            {
              account: account(1, 'Anna Lys', 'anna'),
              rules: [rules(2, 1, '2026-11-01', { vatBps: 550 }), rules(1, 1, '2026-10-01')],
            },
            { account: account(2, 'Inès Moreau', 'ines'), rules: [] },
          ],
        });
      }
      return json(null, 404);
    }),
  );
}

function renderSection(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PayRulesSection />
    </QueryClientProvider>,
  );
}

const plain = (text: string | null | undefined): string => (text ?? '').replaceAll(/\s/gu, ' ');

beforeEach(() => {
  writes.length = 0;
  gate = Promise.resolve();
  settings = { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: null };
  answer = { status: 201, body: rules(9, 2, '2026-10-16') };
  serve();
});

afterEach(() => {
  accounts = null;
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Réglages › Règles de paie', () => {
  it('asks for nothing the page cannot do when there is no account yet', async () => {
    accounts = [];
    renderSection();
    expect(await screen.findByText('Aucun compte plateforme')).toBeTruthy();
    expect(screen.queryByText(/Ajoute un compte/u)).toBeNull();
  });

  it('puts the account without rules first, then each account’s rules in force and to come', async () => {
    renderSection();
    expect(await screen.findByText('Un compte sans règles de paie')).toBeTruthy();
    // One account: its reports, in the singular.
    expect(plain(screen.getByText(/rapports de fin de shift sont refusés/u).textContent)).toMatch(
      /^Ses rapports/u,
    );
    const cards = screen.getAllByRole('listitem').filter((item) => item.classList.contains('rp-account'));
    expect(cards.map((card) => within(card).getByText(/Anna Lys|Inès Moreau/u).textContent)).toEqual([
      'Inès Moreau',
      'Anna Lys',
    ]);
    const anna = plain(cards[1]?.textContent);
    expect(anna).toContain('En vigueur');
    expect(anna).toContain('Euros · TVA 20 % · plateforme 15 % · rapports de fin de shift');
    expect(anna).toContain('À venir');
    expect(anna).toContain('TVA 5,5 %');
  });

  it('offers the current period for an account’s first rules, and posts them after a recap', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Poser les règles' }));
    const dialog = screen.getByRole('dialog', { name: 'Poser les règles de paie' });
    const from = within(dialog).getByLabelText<HTMLSelectElement>('À partir de la quinzaine');
    expect([...from.options].map((option) => option.value).slice(0, 2)).toEqual(['2026-10-16', '2026-11-01']);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).getAllByText('Un taux entre 0 et 100, comme 20 ou 5,5.')).toHaveLength(2);
    expect(within(dialog).queryByRole('button', { name: 'Poser ces règles' })).toBeNull();
  });

  it('sends nothing until the recap is confirmed, then the rules once', async () => {
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Poser les règles' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('TVA'), { target: { value: '20' } });
    fireEvent.change(within(dialog).getByLabelText('Commission de la plateforme'), {
      target: { value: '12,5' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));

    expect(
      plain(within(dialog).getByText('Commission de la plateforme').nextElementSibling?.textContent),
    ).toBe('12,5 %');
    expect(writes).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poser ces règles' }));
    await act(() => Promise.resolve());

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      path: '/v1/team/pay-rules',
      body: {
        platformAccountId: id(12),
        fromPeriod: '2026-10-16',
        currency: 'EUR',
        vatBps: 2_000,
        platformFeeBps: 1_250,
        earningsSource: 'declared',
      },
    });
  });

  it('changes the payout minimum from a period that has not begun, after a recap', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Friday 6 November in Paris: the period under way has begun (PAIE-22).
    vi.setSystemTime(new Date('2026-11-05T23:00:00Z'));
    answer = {
      status: 201,
      body: {
        id: id(900),
        fromPeriod: '2026-12-01',
        minimumPayoutMinor: 2_000,
        createdBy: id(1),
        createdAt: '2026-11-05T23:00:00.000Z',
      },
    };
    renderSection();
    const minimum = (await screen.findByText('Minimum de versement')).closest<HTMLElement>('.rp-account');
    if (minimum === null) throw new Error('No minimum');
    fireEvent.click(await within(minimum).findByRole('button', { name: 'Changer' }));
    expect(plain(minimum.querySelector('.rp-account__rules')?.textContent)).toBe('15,00 €');
    const dialog = screen.getByRole('dialog', { name: 'Minimum de versement' });
    expect(
      within(dialog)
        .getAllByRole('radio')
        .map((one) => [plain(one.textContent), one.getAttribute('aria-checked')]),
    ).toEqual([
      ['16 – 30 novembre', 'true'],
      ['1er – 15 décembre', 'false'],
      ['16 – 31 décembre', 'false'],
      ['1er – 15 janvier', 'false'],
    ]);
    fireEvent.click(within(dialog).getByRole('radio', { name: '1er – 15 décembre' }));
    fireEvent.change(within(dialog).getByLabelText('Minimum'), { target: { value: '20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(plain(within(dialog).getByText(/^À partir de la quinzaine/u).textContent)).toBe(
      'À partir de la quinzaine du 1er au 15 décembre, sous 20,00 €, un relevé ne verse rien et reporte son total sur la quinzaine suivante.',
    );
    expect(writes).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer le minimum' }));
    await act(() => Promise.resolve());
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      path: '/v1/payroll/payout-minimums',
      body: { fromPeriod: '2026-12-01', minimumPayoutMinor: 2_000 },
    });
  });

  it('lets the period that starts today take the minimum, and says so, on the 1st', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // Sunday 1 November in Paris: today's period has not begun yet (PAIE-22).
    vi.setSystemTime(new Date('2026-11-01T09:00:00Z'));
    renderSection();
    const minimum = (await screen.findByText('Minimum de versement')).closest<HTMLElement>('.rp-account');
    if (minimum === null) throw new Error('No minimum');
    fireEvent.click(await within(minimum).findByRole('button', { name: 'Changer' }));
    const dialog = screen.getByRole('dialog', { name: 'Minimum de versement' });
    expect(
      within(dialog).getByRole('radio', { name: '1er – 15 novembre' }).getAttribute('aria-checked'),
    ).toBe('true');
    fireEvent.change(within(dialog).getByLabelText('Minimum'), { target: { value: '20' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).queryByText(/pour celle en cours/u)).toBeNull();
    expect(plain(within(dialog).getByText(/^La quinzaine du jour/u).textContent)).toBe(
      'La quinzaine du jour commence aujourd’hui : elle prend ce minimum. Celles d’avant gardent le leur : une règle de paie ne change pas en cours de route.',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Modifier' }));
    fireEvent.click(within(dialog).getByRole('radio', { name: '16 – 30 novembre' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).getByText(/15,00 € pour celle en cours/u)).toBeTruthy();
  });

  it('says the next minimum beside the one in force', async () => {
    settings = {
      minimumPayoutMinor: 1_500,
      nextMinimum: { fromPeriod: '2026-12-01', minimumPayoutMinor: 0 },
      payoutDelayBusinessDays: null,
    };
    renderSection();
    expect(plain((await screen.findByText(/^Puis/u)).textContent)).toBe(
      'Puis aucun minimum à partir de la quinzaine du 1er au 15 décembre.',
    );
  });

  it('announces a payout delay the owner sets, and withdraws it', async () => {
    answer = {
      status: 200,
      body: { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: 3 },
    };
    renderSection();
    const delay = (await screen.findByText('Délai de versement')).closest<HTMLElement>('.rp-account');
    if (delay === null) throw new Error('No delay');
    expect(await within(delay).findByText('Aucun délai annoncé')).toBeTruthy();
    fireEvent.click(await within(delay).findByRole('button', { name: 'Changer' }));
    const dialog = screen.getByRole('dialog', { name: 'Délai de versement' });
    const days = within(dialog).getByLabelText('Jours ouvrés après la validation');
    fireEvent.change(days, { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer le délai' }));
    expect(within(dialog).getByText('Un nombre entier de jours, de 1 à 30.')).toBeTruthy();
    expect(writes).toEqual([]);
    fireEvent.change(days, { target: { value: '3' } });
    let release = (): void => undefined;
    gate = new Promise((resolve) => {
      release = resolve;
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer le délai' }));
    await act(() => Promise.resolve());
    expect(writes).toEqual([{ path: '/v1/payroll/settings', body: { payoutDelayBusinessDays: 3 } }]);
    // While it is sent, nothing closes the dialog: its refusal would never be seen.
    expect(within(dialog).getByRole('button', { name: 'Annuler' }).hasAttribute('disabled')).toBe(true);
    await act(async () => {
      release();
      await gate;
    });

    cleanup();
    writes.length = 0;
    settings = { minimumPayoutMinor: 1_500, nextMinimum: null, payoutDelayBusinessDays: 3 };
    renderSection();
    const set = (await screen.findByText('Délai de versement')).closest<HTMLElement>('.rp-account');
    if (set === null) throw new Error('No delay');
    expect(plain((await within(set).findByText(/ouvrés/u)).textContent)).toBe(
      '3 jours ouvrés après la validation',
    );
    fireEvent.click(within(set).getByRole('button', { name: 'Changer' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Délai de versement' })).getByRole('button', {
        name: 'Ne plus annoncer de délai',
      }),
    );
    await act(() => Promise.resolve());
    expect(writes).toEqual([{ path: '/v1/payroll/settings', body: { payoutDelayBusinessDays: null } }]);
  });

  it('starts new rules of an account from its last ones, never from a period that has begun', async () => {
    answer = {
      status: 409,
      body: {
        error: {
          code: 'pay_rules_period_conflict',
          message: 'x',
          details: { accountPayRulesId: id(502) },
          requestId: 'r',
        },
      },
    };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelles règles' }));
    const dialog = screen.getByRole('dialog', { name: 'Nouvelles règles de paie' });
    const from = within(dialog).getByLabelText<HTMLSelectElement>('À partir de la quinzaine');
    // 1 November already has rules: the next free periods only.
    expect([...from.options].map((option) => option.value)).toEqual([
      '2026-11-16',
      '2026-12-01',
      '2026-12-16',
    ]);
    expect(within(dialog).getByLabelText<HTMLInputElement>('TVA').value).toBe('5,5');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poser ces règles' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Ce compte a déjà des règles à partir de cette quinzaine.',
    );
  });
});
