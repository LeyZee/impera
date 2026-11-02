// @vitest-environment jsdom
import type { InvoiceListItem } from '@nirvana/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyInvoicesPage } from './MyInvoicesPage';

import { invoiceOf, OCT1, OCT2, payId, SCHEDULING_SETTINGS, THEO } from '@/test/pay';

const NBSP = /[\u00a0\u202f]/gu;

/** What the server holds and answers: the documents of each year asked, and the answer to a write. */
let years: Map<string, InvoiceListItem[]>;
let listStatus: number;
let answer: { status: number; body: unknown };
const writes: { path: string; body: unknown }[] = [];
const reads: string[] = [];

function acceptanceView(item: InvoiceListItem, state: string) {
  return {
    invoiceId: item.id,
    kind: item.kind,
    memberId: item.memberId,
    number: item.number,
    acceptance: { ...item.acceptance, state },
    events: [
      {
        id: payId(990),
        invoiceId: item.id,
        kind: 'issued',
        reason: null,
        statementId: null,
        by: null,
        at: '2026-11-02T09:00:00.000Z',
      },
    ],
  };
}

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        writes.push({
          path: url.pathname,
          body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
        });
        return json(answer.body, answer.status);
      }
      switch (url.pathname) {
        case '/v1/payroll/invoices':
          reads.push(url.search);
          return json(
            { today: '2026-11-05', documents: years.get(url.searchParams.get('from') ?? '') ?? [] },
            listStatus,
          );
        case '/v1/scheduling/settings':
          return json(SCHEDULING_SETTINGS);
        default:
          return json({ items: [], nextCursor: null });
      }
    }),
  );
}

function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/commissions/factures',
    component: MyInvoicesPage,
  });
  const index = createRoute({ getParentRoute: () => root, path: '/commissions', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, index]),
    history: createMemoryHistory({ initialEntries: ['/commissions/factures'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

const PENDING = invoiceOf(1, THEO, OCT2, {
  acceptance: { state: 'pending', deadline: '2026-11-09T22:59:00.000Z', reason: null },
  // A due date near: the chatter never reads it in colour.
  due: 'soon',
  dueOn: '2026-11-10',
});
const PAID = invoiceOf(2, THEO, OCT1, {
  issuedOn: '2026-10-17',
  due: 'settled',
  settlement: { kind: 'paid', statementId: payId(952), on: '2026-10-20' },
});

const rowOf = (number: string): HTMLElement => {
  const row = screen.getByText(number).closest('article');
  if (row === null) throw new Error(`No row for ${number}`);
  return row;
};

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-11-05T09:00:00Z'));
  years = new Map([['2025-11-05', [PENDING, PAID]]]);
  listStatus = 200;
  answer = { status: 200, body: acceptanceView(PENDING, 'accepted') };
  writes.length = 0;
  reads.length = 0;
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Commissions › Factures', () => {
  it('lists the year of documents, the latest first, with the payment on the document and no due date in colour', async () => {
    renderPage();
    const pending = await waitFor(() => rowOf(PENDING.number));
    expect(reads[0]).toBe('?from=2025-11-05&to=2026-11-05');
    expect(screen.getByRole('link', { name: 'Relevés' })).toBeTruthy();
    expect(pending.textContent.replace(NBSP, ' ')).toContain('réponse avant le lundi 9 novembre à 23 h 59');
    expect(within(pending).getByText('À accepter')).toBeTruthy();
    expect(within(pending).queryByText('Bientôt due')).toBeNull();
    expect(pending.dataset['due']).toBeUndefined();
    const paid = rowOf(PAID.number);
    expect(paid.textContent.replace(NBSP, ' ')).toContain('payée le mar. 20 oct.');
    expect(within(paid).queryByRole('button', { name: 'J’accepte' })).toBeNull();
    expect(within(paid).getByRole('link', { name: 'PDF' }).getAttribute('href')).toBe(
      `/v1/payroll/invoices/${PAID.id}/pdf`,
    );
  });

  it('accepts a document once said final, then reads the list again', async () => {
    renderPage();
    const row = await waitFor(() => rowOf(PENDING.number));
    fireEvent.click(within(row).getByRole('button', { name: 'J’accepte' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('définitive');
    const before = reads.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'J’accepte' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(writes).toEqual([{ path: `/v1/payroll/invoices/${PENDING.id}/accept`, body: {} }]);
    expect(reads.length).toBeGreaterThan(before);
  });

  it('contests only with a reason, sent trimmed', async () => {
    answer = { status: 200, body: acceptanceView(PENDING, 'contested') };
    renderPage();
    const row = await waitFor(() => rowOf(PENDING.number));
    fireEvent.click(within(row).getByRole('button', { name: 'Je conteste' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Je conteste' }));
    expect(within(dialog).getByText(/Le motif est obligatoire/u)).toBeTruthy();
    expect(writes).toEqual([]);
    fireEvent.change(within(dialog).getByLabelText('Ce qui ne va pas'), {
      target: { value: '  Il manque mon rapport du 12 octobre.  ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Je conteste' }));
    await waitFor(() => {
      expect(writes).toEqual([
        {
          path: `/v1/payroll/invoices/${PENDING.id}/contest`,
          body: { reason: 'Il manque mon rapport du 12 octobre.' },
        },
      ]);
    });
  });

  it('says a refusal in French and keeps the dialog open', async () => {
    answer = {
      status: 409,
      body: { error: { code: 'invoice_acceptance_conflict', message: 'x', details: {}, requestId: 'r' } },
    };
    renderPage();
    const row = await waitFor(() => rowOf(PENDING.number));
    fireEvent.click(within(row).getByRole('button', { name: 'J’accepte' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'J’accepte' }));
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'Ce document a déjà sa réponse, ou son délai est passé : la liste se met à jour.',
    );
  });

  it('keeps « Plus anciennes » past a year without a document, saying its days, and reads back ten years at most', async () => {
    const older = invoiceOf(3, THEO, '2025-09-01', { issuedOn: '2025-09-17' });
    const oldest = invoiceOf(4, THEO, '2023-03-01', { issuedOn: '2023-03-17' });
    years.set('2024-11-04', [older]);
    years.set('2022-11-03', [oldest]);
    renderPage();
    await waitFor(() => rowOf(PENDING.number));
    const more = () => screen.getByRole('button', { name: 'Plus anciennes' });
    fireEvent.click(more());
    await waitFor(() => rowOf(older.number));
    expect(reads.at(-1)).toBe('?from=2024-11-04&to=2025-11-04');
    // A year without a document (a pause, a departure) does not end the list: its days are said, the next year stays near.
    fireEvent.click(more());
    expect(
      await screen.findByText('Aucun document entre le 4 novembre 2023 et le 3 novembre 2024.'),
    ).toBeTruthy();
    fireEvent.click(more());
    await waitFor(() => rowOf(oldest.number));
    for (let year = 4; year < 10; year += 1) {
      await waitFor(() => {
        expect(more().getAttribute('aria-busy')).toBe('false');
      });
      fireEvent.click(more());
    }
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Plus anciennes' })).toBeNull();
    });
    expect(reads).toHaveLength(10);
    expect(reads.at(-1)).toBe('?from=2016-10-29&to=2017-10-29');
    expect(screen.getByText('Aucun document entre le 29 octobre 2016 et le 2 novembre 2022.')).toBeTruthy();
  });

  it('says a year without a document by its days, never « none at all », and a server that does not answer', async () => {
    years = new Map();
    renderPage();
    expect(
      await screen.findByText('Aucun document entre le 5 novembre 2025 et le 5 novembre 2026.'),
    ).toBeTruthy();
    expect(screen.getByText(/jusqu’à dix ans/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plus anciennes' })).toBeTruthy();
    cleanup();
    listStatus = 500;
    renderPage();
    expect(await screen.findByText(/Le serveur ne répond pas/u)).toBeTruthy();
    expect(screen.queryByText(/Aucun document/u)).toBeNull();
  });
});
