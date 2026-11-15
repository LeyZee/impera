// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoldProvider } from '@/reports/Hold';
import { ReopenProvider } from '@/reports/reopen';
import { TodayPage } from '@/screens/today/TodayPage';
import { THEO_ME } from '@/test/pay';
import { settingsOf } from '@/test/settings';

vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

/* Invented people (ADR 0010). Paris is UTC+1 after 25/10. Now: 01:00 on 28 October in Paris, period 16–31. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SHIFT = id(101);
const OLDER = id(102);
const ACCOUNT = {
  id: id(11),
  creatorId: id(1),
  creatorName: 'Nora Vidal',
  platform: 'reveal',
  handle: 'nora',
  archived: false,
};

const shift = (shiftId: string, startsAt: string, endsAt: string) => ({
  id: shiftId,
  creatorId: id(1),
  platformAccountId: id(11),
  memberId: id(21),
  startsAt,
  endsAt,
  templateId: null,
  stoppedAt: null,
});
const ENDED = shift(SHIFT, '2026-10-27T18:00:00.000Z', '2026-10-27T23:55:00.000Z');
const BEFORE = shift(OLDER, '2026-10-26T18:00:00.000Z', '2026-10-26T23:00:00.000Z');

/** A report as the server sends it; `patch` sets what the test is about. */
interface FakeReport {
  readonly id: string;
  readonly shiftId: string;
  readonly [key: string]: unknown;
}

const report = (patch: Record<string, unknown>): FakeReport => ({
  id: id(301),
  shiftId: OLDER,
  creatorId: id(1),
  platformAccountId: id(11),
  memberId: id(21),
  period: '2026-10-16',
  correctsId: null,
  amount: { amountMinor: 8_000, currency: 'EUR' },
  comment: null,
  incident: null,
  status: 'submitted',
  version: 1,
  byAgency: false,
  reviewKind: null,
  earningsSource: 'declared',
  explanation: null,
  check: null,
  canReview: false,
  submittedAt: '2026-10-27T00:00:00.000Z',
  reviewedAt: null,
  reviewNote: null,
  createdAt: '2026-10-27T00:00:00.000Z',
  ...patch,
});

interface Served {
  reports: FakeReport[];
  rules: unknown;
  /** What `POST`/`PATCH` answer: the status and the body. */
  write: { status: number; body: unknown };
  /** What the server estimates an amount brings (reco 19); `undefined` answers 404. */
  estimate?: (amountMinor: number) => number | null;
}

/** The amounts whose estimate was asked, in order. */
const estimated: number[] = [];

let served: Served;
const writes: { method: string; path: string; body: unknown }[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST' || init?.method === 'PATCH') {
        writes.push({
          method: init.method,
          path: url.pathname,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        });
        return json(served.write.body, served.write.status);
      }
      if (url.pathname === `/v1/payroll/shifts/${SHIFT}/estimate` && served.estimate !== undefined) {
        const amountMinor = Number(url.searchParams.get('amountMinor'));
        estimated.push(amountMinor);
        return json({ commissionMinor: served.estimate(amountMinor) });
      }
      switch (url.pathname) {
        case '/v1/scheduling/my-shifts':
          return json({
            current: null,
            next: null,
            ended: {
              ...ENDED,
              creatorName: 'Nora Vidal',
              platform: 'reveal',
              handle: 'nora',
              accessStartsAt: '2026-10-27T17:45:00.000Z',
              accessEndsAt: '2026-10-28T00:10:00.000Z',
            },
          });
        case '/v1/scheduling/settings':
          return json(settingsOf());
        case '/v1/scheduling/shift-reports':
          return json(
            url.searchParams.get('period') === '2026-10-16'
              ? { reports: served.reports, shifts: [ENDED, BEFORE], accounts: [ACCOUNT], members: [] }
              : { reports: [], shifts: [], accounts: [], members: [] },
          );
        case `/v1/scheduling/shifts/${SHIFT}/report`:
        case `/v1/scheduling/shifts/${OLDER}/report`: {
          const ofShift = url.pathname.includes(SHIFT) ? ENDED : BEFORE;
          return json({
            shift: ofShift,
            account: ACCOUNT,
            period: '2026-10-16',
            opensAt: new Date(new Date(ofShift.endsAt).getTime() - 30 * 60_000).toISOString(),
            rules: served.rules,
            reports: served.reports.filter((one) => one.shiftId === ofShift.id),
          });
        }
        default:
          return json(null, 404);
      }
    }),
  );
}

function renderPage(): void {
  // The app's one hold, as the shell mounts it, and Suivi to leave Aujourd'hui for.
  const root = createRootRoute({
    component: () => (
      <HoldProvider>
        <ReopenProvider>
          <Outlet />
        </ReopenProvider>
      </HoldProvider>
    ),
  });
  const page = createRoute({
    getParentRoute: () => root,
    path: '/aujourdhui',
    component: () => <TodayPage user={THEO_ME} />,
  });
  const tracking = createRoute({
    getParentRoute: () => root,
    path: '/suivi',
    component: () => <p>Écran Suivi</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([page, tracking]),
    history: createMemoryHistory({ initialEntries: ['/aujourdhui'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const amountField = (): HTMLElement => screen.getByLabelText('Ce que tu as généré');

/** What an element says, its spaces plain. */
const said = (element: Element | null | undefined): string =>
  (element?.textContent ?? '').replaceAll(/[\s\u00a0\u202f]+/gu, ' ').trim();

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
  writes.length = 0;
  estimated.length = 0;
  served = {
    reports: [],
    rules: { currency: 'EUR', earningsSource: 'declared' },
    write: {
      status: 201,
      body: report({ id: id(400), shiftId: SHIFT, amount: { amountMinor: 12_050, currency: 'EUR' } }),
    },
  };
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Faire mon rapport', () => {
  it('opens from the ended shift, holds the report five seconds, then sends it once', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    const dialog = await screen.findByRole('dialog', { name: 'Faire mon rapport' });
    expect(within(dialog).getByText('Nora Vidal')).toBeTruthy();

    fireEvent.change(amountField(), { target: { value: '120,50' } });
    fireEvent.change(within(dialog).getByLabelText(/Un mot pour l’agence/u), {
      target: { value: '  Un pack a bien plu  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer mon rapport' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect((await screen.findByRole('status')).textContent).toContain('Envoi du rapport dans 5 s');
    expect(writes).toEqual([]);

    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      method: 'POST',
      path: '/v1/scheduling/shift-reports',
      body: {
        shiftId: SHIFT,
        correctsId: null,
        amountMinor: 12_050,
        currency: 'EUR',
        comment: 'Un pack a bien plu',
        incident: null,
      },
    });
    expect((await screen.findByText(/en attente de validation/u)).textContent).toContain('120,50');
  });

  it('says what the amount brings once the typing pauses, as the server computes it (reco 19)', async () => {
    // 20 % VAT, 20 % to Reveal, 10 %: 120,50 € brings 8,03 €.
    served.estimate = (amountMinor) => Math.round(((amountMinor / 1.2) * 0.8 * 10) / 100);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    const dialog = await screen.findByRole('dialog', { name: 'Faire mon rapport' });
    fireEvent.change(amountField(), { target: { value: '12' } });
    fireEvent.change(amountField(), { target: { value: '120' } });
    fireEvent.change(amountField(), { target: { value: '120,50' } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    const line = await within(dialog).findByText(/^Ta commission estimée/u);
    expect(line.textContent).toMatch(/^Ta commission estimée : 8,03\s€$/u);
    expect(within(dialog).getByText('avant paliers, objectifs, primes et malus')).toBeTruthy();
    // One request when the typing paused, not one a key.
    expect(estimated).toEqual([12_050]);

    // An amount the panel would not send has no estimate.
    fireEvent.change(amountField(), { target: { value: '12,5x' } });
    expect(within(dialog).queryByText(/^Ta commission estimée/u)).toBeNull();
  });

  it('says nothing when the server cannot estimate', async () => {
    served.estimate = () => null;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    const dialog = await screen.findByRole('dialog', { name: 'Faire mon rapport' });
    fireEvent.change(amountField(), { target: { value: '80' } });
    await act(() => vi.advanceTimersByTimeAsync(400));
    expect(estimated).toEqual([8_000]);
    expect(within(dialog).queryByText(/commission estimée/u)).toBeNull();
  });

  it('refuses « 50 € » on an account that declares in dollars, rather than reading it as $50', async () => {
    served.rules = { currency: 'USD', earningsSource: 'declared' };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    const dialog = await screen.findByRole('dialog', { name: 'Faire mon rapport' });
    fireEvent.change(amountField(), { target: { value: '50 €' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer mon rapport' }));
    expect(dialog.textContent).toContain(
      'Ce compte se déclare en dollars : tape le montant seul, sans devise.',
    );
    expect(screen.queryByRole('status')).toBeNull();
    // A code says the same, never a sign the member did not type.
    fireEvent.change(amountField(), { target: { value: '50 EUR' } });
    expect(dialog.textContent).toContain('tape le montant seul, sans devise.');
    fireEvent.change(amountField(), { target: { value: '50 $' } });
    expect(dialog.textContent).not.toContain('Ce compte se déclare en dollars');
  });

  it('takes the report back on « Annuler », with nothing sent, and opens it again as it was', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    await screen.findByRole('dialog');
    fireEvent.change(amountField(), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon rapport' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Annuler' }));
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(writes).toEqual([]);
    expect(amountField()).toBe(screen.getByDisplayValue('45'));
  });

  it('asks for an amount it can read, and an incident in words', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    await screen.findByRole('dialog');
    fireEvent.change(amountField(), { target: { value: 'douze' } });
    fireEvent.click(screen.getByRole('switch', { name: /Signaler un incident/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon rapport' }));

    expect(screen.getByText(/Un montant comme 120 ou 85,50/u)).toBeTruthy();
    expect(screen.getByText('Dis en une phrase ce qui s’est passé.')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('takes the reader to the first field to fix', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    await screen.findByRole('dialog');
    fireEvent.change(amountField(), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('switch', { name: /Signaler un incident/u }));
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon rapport' }));

    expect(document.activeElement).toBe(screen.getByLabelText('Ce qui s’est passé'));
  });

  it('says a refusal wherever the chatter went since, and « Rouvrir » takes them back to it as it was', async () => {
    served.write = {
      status: 409,
      body: { error: { code: 'shift_report_early_conflict', message: 'x', details: {}, requestId: 'r' } },
    };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    await screen.findByRole('dialog');
    fireEvent.change(amountField(), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon rapport' }));
    fireEvent.click(screen.getByRole('link', { name: 'Ouvrir Suivi' }));
    await screen.findByText('Écran Suivi');
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(writes).toHaveLength(1);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rapport non envoyé');
    expect(alert.textContent).toContain('30 minutes avant au plus tôt');

    // Aujourd'hui is gone with its panel: « Rouvrir » goes back to it and opens the report there.
    fireEvent.click(within(alert).getByRole('button', { name: 'Rouvrir' }));
    const dialog = await screen.findByRole('dialog', { name: 'Faire mon rapport' });
    expect(screen.queryByText('Écran Suivi')).toBeNull();
    expect(within(dialog).getByDisplayValue('30')).toBe(amountField());
  });

  it('takes the report back on « Annuler » from Suivi, on Aujourd’hui as it was', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    await screen.findByRole('dialog');
    fireEvent.change(amountField(), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon rapport' }));
    fireEvent.click(screen.getByRole('link', { name: 'Ouvrir Suivi' }));
    await screen.findByText('Écran Suivi');

    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    const dialog = await screen.findByRole('dialog', { name: 'Faire mon rapport' });
    expect(within(dialog).getByDisplayValue('45')).toBe(amountField());
    await act(() => vi.advanceTimersByTimeAsync(6_000));
    expect(writes).toEqual([]);
  });

  it('sends at once when the app goes to the background', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    await screen.findByRole('dialog');
    fireEvent.change(amountField(), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon rapport' }));
    // Back to Reveal: the phone hides the app without `pagehide`, and its timers sleep.
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    try {
      document.dispatchEvent(new Event('visibilitychange'));
      await act(() => vi.advanceTimersByTimeAsync(0));
      expect(writes).toHaveLength(1);
    } finally {
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    }
    expect((await screen.findByText(/en attente de validation/u)).textContent).toContain('30,00');
  });

  it('says a refusal in the island and opens the report again from it', async () => {
    served.write = {
      status: 409,
      body: { error: { code: 'pay_rules_missing_conflict', message: 'x', details: {}, requestId: 'r' } },
    };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    await screen.findByRole('dialog');
    fireEvent.change(amountField(), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon rapport' }));
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Rapport non envoyé');
    expect(alert.textContent).toContain('ne sont pas posées pour cette quinzaine');
    fireEvent.click(within(alert).getByRole('button', { name: 'Rouvrir' }));
    expect(amountField()).toBe(screen.getByDisplayValue('30'));
  });

  it('says there is nothing to declare yet while the account has no pay rules', async () => {
    served.rules = null;
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Faire mon rapport' }));
    expect(await screen.findByText('Pas encore de règles de paie')).toBeTruthy();
    expect(screen.queryByLabelText('Ce que tu as généré')).toBeNull();
  });
});

describe('Mes rapports', () => {
  it('lists a report sent back with its note, and sends it again with the version it read', async () => {
    served.reports = [
      report({ status: 'rejected', version: 2, reviewNote: 'Il manque le pourboire de 20 €' }),
    ];
    served.write = { status: 200, body: report({ status: 'submitted', version: 3 }) };
    renderPage();

    const back = await screen.findByRole('button', { name: /Rapport renvoyé par l’agence/u });
    expect(back.textContent).toContain('Il manque le pourboire de 20 €');
    fireEvent.click(back);
    const dialog = await screen.findByRole('dialog', { name: 'Reprendre mon rapport' });
    expect(amountField()).toBe(screen.getByDisplayValue('80,00'));
    fireEvent.change(amountField(), { target: { value: '100' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Renvoyer' }));
    await act(() => vi.advanceTimersByTimeAsync(5_000));

    expect(writes).toEqual([
      {
        method: 'PATCH',
        path: `/v1/scheduling/shift-reports/${id(301)}`,
        body: { version: 2, amountMinor: 10_000, comment: null, incident: null },
      },
    ]);
  });

  it('asks nothing more of a report whose fortnight switched to the sales read, and says it without effect (ADR 0084 § 3)', async () => {
    served.reports = [
      report({
        status: 'rejected',
        version: 2,
        reviewNote: 'Il manque le pourboire de 20 €',
        earningsSource: 'detected',
      }),
    ];
    served.rules = { currency: 'EUR', earningsSource: 'detected' };
    renderPage();
    const mine = await screen.findByText('Tous mes rapports');
    expect(said(mine.closest('details')?.querySelector('summary'))).toContain('1 sans effet sur la paie');
    // Nothing to take up again: no « Renvoyé » in what is left to do.
    expect(screen.queryByRole('button', { name: /Rapport renvoyé par l’agence/u })).toBe(null);
    const line = mine.closest('details')?.querySelector('.rp-line');
    if (!(line instanceof HTMLButtonElement)) throw new Error('no line');
    expect(said(line.querySelector('.rp-chip'))).toBe('Sans effet sur la paie');
    fireEvent.click(line);
    const dialog = await screen.findByRole('dialog', { name: 'Mon rapport' });
    expect(await within(dialog).findByText('Sans effet sur la paie')).toBeTruthy();
    expect(said(dialog)).toContain('Ce rapport de 80,00 € reste');
    expect(within(dialog).queryByLabelText('Ce que tu as généré')).toBe(null);
  });

  it('says nothing validated in a currency where nothing is, rather than « Validé 0,00 $US »', async () => {
    served.reports = [report({ amount: { amountMinor: 8_000, currency: 'USD' } })];
    renderPage();
    const mine = await screen.findByText('Tous mes rapports');
    const text = (mine.closest('section')?.textContent ?? '').replaceAll(/\s/gu, ' ');
    expect(text).toContain('En attente80,00 $US');
    expect(text).not.toContain('Validé');
  });

  it('says a report validated at zero, beside one waiting, as the list counts it', async () => {
    served.reports = [
      report({
        status: 'validated',
        reviewedAt: '2026-10-27T08:00:00.000Z',
        amount: { amountMinor: 0, currency: 'EUR' },
      }),
      report({ id: id(304), shiftId: SHIFT, amount: { amountMinor: 1_500, currency: 'EUR' } }),
    ];
    renderPage();
    const mine = await screen.findByText('Tous mes rapports');
    const text = (mine.closest('section')?.textContent ?? '').replaceAll(/\s/gu, ' ');
    expect(text).toContain('Ventes validées0,00 €');
    expect(text).toContain('En attente15,00 €');
    expect(text).toContain('1 validé · 1 en attente');
  });

  it('sums the period: validated, what waits for the agency, what came back, counted the same way', async () => {
    served.reports = [
      report({ status: 'validated', reviewedAt: '2026-10-27T08:00:00.000Z' }),
      report({ id: id(302), correctsId: id(301), amount: { amountMinor: 1_500, currency: 'EUR' } }),
      report({
        id: id(303),
        shiftId: SHIFT,
        status: 'rejected',
        reviewNote: 'Le pourboire',
        amount: { amountMinor: 4_000, currency: 'EUR' },
      }),
    ];
    renderPage();
    const mine = await screen.findByText('Tous mes rapports');
    const card = mine.closest('section');
    const text = (card?.textContent ?? '').replaceAll(/\s/gu, ' ');
    expect(text).toContain('Ventes validées80,00 €');
    expect(text).toContain('En attente15,00 €');
    expect(text).toContain('Renvoyé40,00 €');
    // Report by report: the correction waiting is said on its line, not counted as a report.
    expect(text).toContain('1 validé · 1 renvoyé');
    expect(text).toContain('correction en attente');
  });

  it('says on which day a report was validated, unless it was today', async () => {
    served.reports = [report({ status: 'validated', reviewedAt: '2026-10-26T08:00:00.000Z' })];
    renderPage();
    fireEvent.click(await screen.findByText('Tous mes rapports'));
    fireEvent.click(await screen.findByRole('button', { name: /Validé/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Mon rapport' });
    expect(dialog.textContent).toMatch(/Validé le lun\. 26 oct\. à 9\sh/u);
    // A correction started from it is titled as one at once, not only when reopened.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Ajouter une correction' }));
    expect(await screen.findByRole('dialog', { name: 'Corriger mon rapport' })).toBeTruthy();
  });

  it('writes the true minus sign in a correction, as its hint and its estimate do (captures of #591)', async () => {
    served.reports = [report({ status: 'validated', reviewedAt: '2026-10-26T08:00:00.000Z' })];
    renderPage();
    fireEvent.click(await screen.findByText('Tous mes rapports'));
    fireEvent.click(await screen.findByRole('button', { name: /Validé/u }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Mon rapport' })).getByRole('button', {
        name: 'Ajouter une correction',
      }),
    );
    const correcting = await screen.findByRole('dialog', { name: 'Corriger mon rapport' });
    const amount = within(correcting).getByLabelText('À ajouter ou retirer');
    fireEvent.change(amount, { target: { value: '-15' } });
    expect(amount).toHaveProperty('value', '−15');
  });
});

describe('Mon rapport against Reveal (ADR 0073)', () => {
  /** 80,00 € declared on the shift of the 26th, 70,00 € read: 48 hours after its end, Thursday 0 h in Paris. */
  const GAP = {
    state: 'complete',
    readMinor: 7_000,
    gapMinor: 1_000,
    verdict: 'gap',
    explainBy: '2026-10-28T23:00:00.000Z',
  };

  it('puts a gap to explain in « À faire », and sends the explanation with the version it read (§ 5)', async () => {
    served.reports = [report({ check: GAP })];
    served.write = {
      status: 200,
      body: report({ check: GAP, version: 2, explanation: 'Un pourboire noté deux fois.' }),
    };
    renderPage();

    const todo = await screen.findByRole('button', { name: /Écart de .* avec Reveal/u });
    expect(todo.textContent.replaceAll(' ', ' ')).toContain('Écart de +10,00 € avec Reveal');
    expect(todo.textContent).toContain('Expliquer');
    fireEvent.click(todo);
    const dialog = await screen.findByRole('dialog', { name: 'Modifier mon rapport' });
    const said = dialog.textContent.replaceAll(' ', ' ');
    expect(said).toContain('Tu déclares 80,00 €, Reveal a lu 70,00 € pendant ton shift.');
    expect(said).toMatch(/Corrige le montant, ou explique l’écart avant le jeu\. 29 oct\. à 0 h/u);

    fireEvent.change(within(dialog).getByLabelText(/Pourquoi cet écart/u), {
      target: { value: '  Un pourboire noté deux fois.  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Enregistrer' }));
    await act(() => vi.advanceTimersByTimeAsync(5_000));
    expect(writes).toEqual([
      {
        method: 'PATCH',
        path: `/v1/scheduling/shift-reports/${id(301)}`,
        body: {
          version: 1,
          amountMinor: 8_000,
          comment: null,
          incident: null,
          explanation: 'Un pourboire noté deux fois.',
        },
      },
    ]);
  });

  it('says an explanation sent leaves the decision to the agency, and asks for nothing more', async () => {
    served.reports = [report({ check: GAP, explanation: 'Un pourboire noté deux fois.' })];
    renderPage();
    fireEvent.click(await screen.findByText('Tous mes rapports'));
    const chip = await screen.findByRole('button', { name: /En attente/u });
    expect(chip.textContent).not.toContain('Écart');
    expect(screen.queryByRole('button', { name: /Écart de .* avec Reveal/u })).toBe(null);
    fireEvent.click(chip);
    const dialog = await screen.findByRole('dialog', { name: 'Modifier mon rapport' });
    expect(dialog.textContent).toContain('Ton explication est envoyée : l’agence décide.');
    expect(within(dialog).getByLabelText(/Pourquoi cet écart/u)).toHaveProperty(
      'value',
      'Un pourboire noté deux fois.',
    );
  });

  it('says a report that matches Reveal validates by itself, and a validation made by the check', async () => {
    served.reports = [
      report({
        status: 'validated',
        reviewKind: 'automatic',
        reviewedAt: '2026-10-26T23:20:00.000Z',
        check: { state: 'complete', readMinor: 8_000, gapMinor: 0, verdict: 'within', explainBy: null },
      }),
    ];
    renderPage();
    fireEvent.click(await screen.findByText('Tous mes rapports'));
    fireEvent.click(await screen.findByRole('button', { name: /Validé/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Mon rapport' });
    const said = dialog.textContent.replaceAll(' ', ' ');
    expect(said).toMatch(/Validé automatiquement le mar\. 27 oct\. à 0 h 20/u);
    expect(said).toContain('Reveal a lu 80,00 € pendant ce shift');
  });

  it('says why a report is not compared, without holding it (§ 7)', async () => {
    served.reports = [report({ check: { state: 'unavailable', reason: 'feed_off' } })];
    renderPage();
    fireEvent.click(await screen.findByText('Tous mes rapports'));
    fireEvent.click(await screen.findByRole('button', { name: /En attente/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Modifier mon rapport' });
    expect(dialog.textContent).toContain(
      'Les ventes de Reveal ne sont pas lues en ce moment : rien n’est comparé, la relecture se fait comme avant.',
    );
    expect(within(dialog).queryByLabelText(/Pourquoi cet écart/u)).toBe(null);
  });
});
