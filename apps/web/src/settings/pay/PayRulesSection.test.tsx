// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PayRulesSection } from './PayRulesSection';

import { SCHEDULING_SETTINGS } from '@/test/pay';
import { chooseValue, valuesOf } from '@/test/select';

/* Invented creators and accounts (ADR 0010); the rates are examples, not anyone's. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const account = (n: number, creatorName: string, handle: string) => ({
  id: id(10 + n),
  creatorId: id(n),
  creatorName,
  platform: 'reveal',
  handle,
  archived: false,
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
/** The threshold of a report against its platform (ADR 0073 § 3). */
let threshold: Record<string, unknown>;
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
      if (url.pathname === '/v1/scheduling/report-gap') return json(threshold);
      if (url.pathname === '/v1/scheduling/settings') return json(SCHEDULING_SETTINGS);
      if (url.pathname === '/v1/team/pay-rules') {
        return json({
          currentPeriod: '2026-10-16',
          accounts: accounts ?? [
            {
              account: account(1, 'Anna Lys', 'anna'),
              rules: [rules(2, 1, '2026-11-01', { vatBps: 550 }), rules(1, 1, '2026-10-01')],
              checkedPeriod: null,
            },
            { account: account(2, 'Inès Moreau', 'ines'), rules: [], checkedPeriod: null },
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
  threshold = { bps: 100, minor: 500 };
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
    const from = within(dialog).getByRole('combobox', { name: 'À partir de la quinzaine' });
    expect(valuesOf(from).slice(0, 2)).toEqual(['2026-10-16', '2026-11-01']);

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

  it('says the ceiling of a minimum too large, not decimals (recette 05/11, PRO-09)', async () => {
    renderSection();
    const minimum = (await screen.findByText('Minimum de versement')).closest<HTMLElement>('.rp-account');
    if (minimum === null) throw new Error('No minimum');
    fireEvent.click(await within(minimum).findByRole('button', { name: 'Changer' }));
    const dialog = screen.getByRole('dialog', { name: 'Minimum de versement' });
    fireEvent.change(within(dialog).getByLabelText('Minimum'), { target: { value: '5000,01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(plain(within(dialog).getByText(/^Au plus/u).textContent)).toBe('Au plus 5 000,00 €.');
    fireEvent.change(within(dialog).getByLabelText('Minimum'), { target: { value: '12,345' } });
    expect(within(dialog).getByText('Un montant en euros, deux décimales au plus.')).toBeTruthy();
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

  it('changes the threshold of a report against the platform after a recap (ADR 0073 § 3)', async () => {
    renderSection();
    const card = (await screen.findByText('Seuil d’écart des rapports')).closest<HTMLElement>('.rp-account');
    if (card === null) throw new Error('No threshold');
    fireEvent.click(await within(card).findByRole('button', { name: 'Changer' }));
    expect(plain(card.querySelector('.rp-account__rules')?.textContent)).toBe('1 % ou 5,00 €');
    expect(plain(card.textContent)).toContain(
      'Sur un compte dont les ventes sont lues, un rapport se valide tout seul s’il n’est pas au-dessus des ventes lues et s’en écarte de 1 % au plus, ou de 5,00 € au plus.',
    );
    const dialog = screen.getByRole('dialog', { name: 'Seuil d’écart' });
    expect(within(dialog).getByLabelText('Écart en pourcentage')).toHaveProperty('value', '1');
    fireEvent.change(within(dialog).getByLabelText('Écart en pourcentage'), { target: { value: '120' } });
    fireEvent.change(within(dialog).getByLabelText('Ou écart en montant'), { target: { value: '1000,01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).getByText('Un taux entre 0 et 100, comme 1 ou 2,5.')).toBeTruthy();
    expect(plain(within(dialog).getByText(/^Un montant de 0 à/u).textContent)).toBe(
      'Un montant de 0 à 1 000,00 €, deux décimales au plus.',
    );

    fireEvent.change(within(dialog).getByLabelText('Écart en pourcentage'), { target: { value: '2,5' } });
    fireEvent.change(within(dialog).getByLabelText('Ou écart en montant'), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(plain(within(dialog).getByText(/^À partir de maintenant/u).textContent)).toBe(
      'À partir de maintenant, un rapport se valide tout seul s’il n’est pas au-dessus des ventes lues et s’en écarte de 2,5 % au plus.',
    );
    expect(writes).toEqual([]);
    answer = { status: 200, body: { bps: 250, minor: 0 } };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer le seuil' }));
    await act(() => Promise.resolve());
    expect(writes).toEqual([{ path: '/v1/scheduling/report-gap', body: { bps: 250, minor: 0 } }]);
  });

  it('says a threshold at zero lets only a report equal to the platform through', async () => {
    threshold = { bps: 0, minor: 0 };
    renderSection();
    const card = (await screen.findByText('Aucun écart')).closest<HTMLElement>('.rp-account');
    expect(plain(card?.querySelector('.rp-account__name')?.textContent)).toBe('Seuil d’écart des rapports');
    expect(plain(card?.textContent)).toContain('seul un rapport égal aux ventes lues se valide tout seul.');
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
    const from = within(dialog).getByRole('combobox', { name: 'À partir de la quinzaine' });
    // 1 November already has rules: the next free periods only.
    expect(valuesOf(from)).toEqual(['2026-11-16', '2026-12-01', '2026-12-16']);
    expect(within(dialog).getByLabelText<HTMLInputElement>('TVA').value).toBe('5,5');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poser ces règles' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Ce compte a déjà des règles à partir de cette quinzaine.',
    );
  });

  it('says why « Ventes relevées » is refused, by the reason the server gives', async () => {
    answer = {
      status: 409,
      body: {
        error: {
          code: 'pay_rules_source_conflict',
          message: 'x',
          details: { reason: 'check_not_clean' },
          requestId: 'r',
        },
      },
    };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelles règles' }));
    const dialog = screen.getByRole('dialog', { name: 'Nouvelles règles de paie' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poser ces règles' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'La dernière vérification de fiabilité ne peut pas porter la bascule : il en faut une sur une quinzaine entière, où les ventes lues concordent avec les statistiques par jour (et avec l’export, facultatif, s’il est joint) et où aucune note ne reste à régler. Refais-la dans Réglages › Ventes.',
    );
  });

  it('switches a Reveal account to its sales read from the checked fortnight, said before it is posted (ADR 0084)', async () => {
    accounts = [{ account: account(2, 'Inès Moreau', 'ines'), rules: [], checkedPeriod: '2026-10-01' }];
    answer = { status: 201, body: rules(9, 2, '2026-10-01', { earningsSource: 'detected' }) };
    renderSection();
    const card = (await screen.findByText('Inès Moreau')).closest<HTMLElement>('.rp-account');
    if (card === null) throw new Error('No card');
    expect(plain(card.textContent)).toContain(
      'Ventes vérifiéespeut passer aux ventes relevées dès la quinzaine du 1er au 15 octobre',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Poser les règles' }));
    const dialog = screen.getByRole('dialog', { name: 'Poser les règles de paie' });
    const from = within(dialog).getByRole('combobox', { name: 'À partir de la quinzaine' });
    // The reports never start with a fortnight over: the checked one comes with « Ventes relevées » only.
    expect(valuesOf(from)[0]).toBe('2026-10-16');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Ventes relevées par le connecteur' }));
    expect(valuesOf(from).slice(0, 2)).toEqual(['2026-10-01', '2026-10-16']);
    // Until the owner picks another, the earliest the source allows: the checked fortnight.
    expect(plain(from.textContent)).toContain('1er au 15 octobre');
    // The platform gives the net: neither VAT nor commission is asked, the recap says they go unused.
    expect(within(dialog).queryByLabelText('TVA')).toBeNull();
    expect(within(dialog).queryByLabelText('Commission de la plateforme')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(plain(within(dialog).getByText('TVA et commission').nextElementSibling?.textContent)).toBe(
      'Sans effet',
    );

    expect(plain(within(dialog).getByText(/^Cette quinzaine a déjà commencé/u).textContent)).toBe(
      'Cette quinzaine a déjà commencé : ses relevés en brouillon seront recalculés sur les ventes relevées, et les ventes déclarées dans ses rapports ne compteront plus.',
    );
    expect(writes).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poser ces règles' }));
    await act(() => Promise.resolve());
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      path: '/v1/team/pay-rules',
      body: {
        platformAccountId: id(12),
        fromPeriod: '2026-10-01',
        earningsSource: 'detected',
        vatBps: 0,
        platformFeeBps: 0,
      },
    });
  });

  it('leaves the VAT and the commission out of rules on the platform’s net (ADR 0084)', async () => {
    accounts = [
      {
        account: account(2, 'Inès Moreau', 'ines'),
        rules: [rules(9, 2, '2026-10-01', { earningsSource: 'detected' })],
        checkedPeriod: null,
      },
    ];
    renderSection();
    const card = (await screen.findByText('Inès Moreau')).closest<HTMLElement>('.rp-account');
    if (card === null) throw new Error('No card');
    expect(plain(card.textContent)).toContain(
      'Euros · ventes relevées par le connecteur · net de la plateforme',
    );
    expect(plain(card.textContent)).not.toContain('TVA');
  });

  it('takes the checked fortnight back with the reports, and keeps « Ventes relevées » shut on a platform without a net', async () => {
    accounts = [
      { account: account(2, 'Inès Moreau', 'ines'), rules: [], checkedPeriod: '2026-10-01' },
      { account: { ...account(3, 'Léa Brun', 'lea'), platform: 'onlyfans' }, rules: [], checkedPeriod: null },
    ];
    renderSection();
    const ines = (await screen.findByText('Inès Moreau')).closest<HTMLElement>('.rp-account');
    if (ines === null) throw new Error('No card');
    fireEvent.click(within(ines).getByRole('button', { name: 'Poser les règles' }));
    let dialog = screen.getByRole('dialog', { name: 'Poser les règles de paie' });
    const from = within(dialog).getByRole('combobox', { name: 'À partir de la quinzaine' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Ventes relevées par le connecteur' }));
    chooseValue(from, '2026-10-01');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Rapports de fin de shift' }));
    expect(valuesOf(from)).not.toContain('2026-10-01');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    expect(within(dialog).queryByText(/^Cette quinzaine a déjà commencé/u)).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Annuler' }));

    const lea = screen.getByText('Léa Brun').closest<HTMLElement>('.rp-account');
    if (lea === null) throw new Error('No card');
    fireEvent.click(within(lea).getByRole('button', { name: 'Poser les règles' }));
    dialog = screen.getByRole('dialog', { name: 'Poser les règles de paie' });
    expect(
      within(dialog)
        .getByRole('radio', { name: 'Ventes relevées par le connecteur' })
        .hasAttribute('disabled'),
    ).toBe(true);
    expect(
      within(dialog).getByText(
        'Cette plateforme ne donne pas de net : la paie de ce compte lit les rapports validés.',
      ),
    ).toBeTruthy();
  });

  it('says a fortnight closed by pay cannot be switched any more', async () => {
    accounts = [{ account: account(2, 'Inès Moreau', 'ines'), rules: [], checkedPeriod: '2026-10-01' }];
    answer = {
      status: 409,
      body: {
        error: {
          code: 'pay_rules_source_conflict',
          message: 'x',
          details: { reason: 'period_closed' },
          requestId: 'r',
        },
      },
    };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Poser les règles' }));
    const dialog = screen.getByRole('dialog', { name: 'Poser les règles de paie' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Ventes relevées par le connecteur' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poser ces règles' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'La paie a déjà clôturé une quinzaine depuis la quinzaine vérifiée : ses montants ne changent plus. Fais partir ces règles d’une quinzaine qui n’a pas commencé.',
    );
  });

  it('says the refusal by its code when the reason is one the screen does not know', async () => {
    answer = {
      status: 409,
      body: {
        error: {
          code: 'pay_rules_source_conflict',
          message: 'x',
          details: { reason: 'something_new' },
          requestId: 'r',
        },
      },
    };
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelles règles' }));
    const dialog = screen.getByRole('dialog', { name: 'Nouvelles règles de paie' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Vérifier' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Poser ces règles' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe(
      'Ce compte ne peut pas encore être payé sur le net de sa plateforme : sa paie se lit dans les rapports validés.',
    );
  });
});
