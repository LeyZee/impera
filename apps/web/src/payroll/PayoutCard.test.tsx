// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyPayoutCard, PayoutLine, PayoutTo } from './PayoutCard';

/* Invented people and numbers (ADR 0010). */
const MEMBER = '0199f2a0-0000-7000-8000-000000000021';
const MOMO = {
  method: 'mobile_money',
  beneficiary: 'Basile Inventé',
  phone: '+22900000001',
  operator: 'Opérateur fictif',
  note: null,
} as const;

let stored: Record<string, unknown> | null;
let reauthOnce: boolean;
let listFails: boolean;
const writes: { method: string; path: string; body: unknown }[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        writes.push({ method, path: url.pathname, body });
        if (reauthOnce) {
          reauthOnce = false;
          return json(
            { error: { code: 'reauthentication_forbidden', message: 'x', details: {}, requestId: 'r' } },
            403,
          );
        }
        if (method === 'POST') {
          return json({
            memberId: MEMBER,
            method: 'mobile_money',
            changedAt: '2026-11-20T10:00:00.000Z',
            details: MOMO,
          });
        }
        stored = { ...MOMO, phone: '+22900000001' };
        return json(
          {
            memberId: MEMBER,
            method: 'mobile_money',
            changedAt: '2026-11-21T10:00:00.000Z',
            details: stored,
          },
          201,
        );
      }
      if (url.pathname === '/v1/payroll/payout-destinations') {
        if (listFails) return json(null, 500);
        return json({ destinations: [{ memberId: MEMBER, method: null, changedAt: null }] });
      }
      if (url.pathname === `/v1/payroll/contractors/${MEMBER}/payout-destination`) {
        return json({
          memberId: MEMBER,
          method: stored === null ? null : 'mobile_money',
          changedAt: stored === null ? null : '2026-11-21T10:00:00.000Z',
          details: stored,
        });
      }
      return json(null, 404);
    }),
  );
}

const wrap = (node: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {node}
    </QueryClientProvider>,
  );

beforeEach(() => {
  stored = null;
  reauthOnce = false;
  listFails = false;
  writes.length = 0;
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Dossier : « Où te verser » (ADR 0165)', () => {
  it('says « À remplir » first, then sends the way he receives and its number as typed', async () => {
    wrap(<MyPayoutCard memberId={MEMBER} zone="Europe/Paris" />);
    expect(await screen.findByText('À remplir')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mobile money' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.change(screen.getByLabelText('Nom du bénéficiaire'), { target: { value: 'Basile Inventé' } });
    fireEvent.change(screen.getByLabelText('Numéro mobile money'), { target: { value: '+229 00 00 00 01' } });
    fireEvent.change(screen.getByLabelText('Opérateur'), { target: { value: 'Opérateur fictif' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toEqual({
      method: 'PUT',
      path: `/v1/payroll/contractors/${MEMBER}/payout-destination`,
      body: { ...MOMO, phone: '+229 00 00 00 01' },
    });
    expect(await screen.findByText('+229 00 00 00 01')).toBeTruthy();
    expect(screen.getByText('Basile Inventé')).toBeTruthy();
  });

  it('refuses a number in the wrong form without sending, and asks the password again when the server says so', async () => {
    wrap(<MyPayoutCard memberId={MEMBER} zone="Europe/Paris" />);
    await screen.findByText('À remplir');
    fireEvent.change(screen.getByLabelText('Nom du bénéficiaire'), { target: { value: 'Basile Inventé' } });
    fireEvent.change(screen.getByLabelText('Numéro mobile money'), { target: { value: '0102' } });
    fireEvent.change(screen.getByLabelText('Opérateur'), { target: { value: 'Opérateur fictif' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText('Un numéro au format +229…')).toBeTruthy();
    expect(writes).toEqual([]);

    reauthOnce = true;
    fireEvent.change(screen.getByLabelText('Numéro mobile money'), { target: { value: '+22900000001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    expect(await screen.findByText(/touche à l’argent/u)).toBeTruthy();
  });
});

describe('Paie › « Marquer payé » : où le verser (ADR 0165)', () => {
  it('says a recent change in amber, and shows the number only on « Afficher »', async () => {
    wrap(
      <PayoutTo
        memberId={MEMBER}
        memberName="Basile"
        summary={{ method: 'mobile_money', changedAt: '2026-11-20T10:00:00.000Z' }}
        zone="Europe/Paris"
        now={new Date('2026-11-21T12:00:00Z')}
      />,
    );
    expect(screen.getByText('Mobile money')).toBeTruthy();
    expect(screen.getByText(/Changé récemment/u).getAttribute('data-tone')).toBe('warn');
    expect(screen.queryByText('+229 00 00 00 01')).toBe(null);
    fireEvent.click(screen.getByRole('button', { name: 'Afficher' }));
    expect(await screen.findByText('+229 00 00 00 01')).toBeTruthy();
    expect(writes).toEqual([
      { method: 'POST', path: `/v1/payroll/contractors/${MEMBER}/payout-destination/reveal`, body: null },
    ]);
  });

  it('says in amber that he has not filled it, and that the owner cannot', () => {
    wrap(
      <PayoutTo memberId={MEMBER} memberName="Basile" summary={null} zone="Europe/Paris" now={new Date()} />,
    );
    expect(screen.getByText('Où le verser : pas encore rempli')).toBeTruthy();
    expect(screen.getByText(/tu ne peux pas le saisir pour lui/u)).toBeTruthy();
  });

  it('says a failed read with « Réessayer », never « pas encore rempli »', async () => {
    listFails = true;
    wrap(<PayoutLine memberId={MEMBER} memberName="Basile" zone="Europe/Paris" />);
    expect(await screen.findByText('Où le verser : pas lu')).toBeTruthy();
    expect(screen.queryByText('Où le verser : pas encore rempli')).toBe(null);
    listFails = false;
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Où le verser : pas encore rempli')).toBeTruthy();
  });
});
