// @vitest-environment jsdom
import { MySaleClaimsSchema, PendingSaleClaimsSchema, PayPeriodSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { MySaleClaimsPanel } from './MySaleClaimsPanel';
import { SaleClaimsPanel } from './SaleClaimsPanel';
import type { PayNames } from './data';

import { SCHEDULING_SETTINGS } from '@/test/pay';

// Everything below is invented (ADR 0010).
const NOV16 = PayPeriodSchema.parse('2026-11-16');
const THEO_MEMBER = '01900000-0000-7000-8000-0000000000a1';
const LEA_MEMBER = '01900000-0000-7000-8000-0000000000a2';
const LEA_USER = 'user_lea';
const ACCOUNT = '01900000-0000-7000-8000-0000000000b1';
const shiftOf = (n: number, startsAt: string, endsAt: string) => ({
  shiftId: `01900000-0000-7000-8000-00000000000${String(n)}`,
  creatorName: 'Nora Vidal',
  platformAccountId: ACCOUNT,
  platform: 'reveal',
  handle: 'nora',
  startsAt,
  endsAt,
});
const S1 = shiftOf(1, '2026-11-21T13:05:00.000Z', '2026-11-21T19:05:00.000Z');
const S2 = shiftOf(2, '2026-11-22T13:00:00.000Z', '2026-11-22T19:00:00.000Z');
const S3 = shiftOf(3, '2026-11-23T13:00:00.000Z', '2026-11-23T19:00:00.000Z');
const claimOf = (
  n: number,
  shift: typeof S1,
  state: string,
  answerNote: string | null = null,
  memberId = THEO_MEMBER,
) => ({
  id: `01900000-0000-7000-8000-0000000000c${String(n)}`,
  memberId,
  period: NOV16,
  shift,
  note: 'Le fan au pseudo en « m », je l’ai chauffé tout le shift.',
  state,
  answerNote,
  createdAt: '2026-11-24T10:00:00.000Z',
  answeredAt: state === 'waiting' ? null : '2026-11-24T12:00:00.000Z',
});

const NBSP = /[\u00a0\u202f]/gu;
const text = (): string => document.body.textContent.replace(NBSP, ' ');
const SentSchema = z.object({ url: z.string(), body: z.record(z.string(), z.unknown()) });

let mine: unknown;
let pending: unknown;
let sent: z.infer<typeof SentSchema>[];

beforeEach(() => {
  sent = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'POST') {
        const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '{}');
        sent.push(SentSchema.parse({ url: url.pathname, body }));
        if (url.pathname === '/v1/payroll/sale-claims') return json(claimOf(9, S2, 'waiting'), 201);
        return json(claimOf(8, S1, 'settled'));
      }
      if (url.pathname === '/v1/payroll/sale-claims/mine') return json(mine);
      if (url.pathname === '/v1/payroll/sale-claims') return json(pending);
      if (url.pathname === '/v1/scheduling/settings') return json(SCHEDULING_SETTINGS);
      return json({}, 404);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function show(part: JSX.Element): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {part}
    </QueryClientProvider>,
  );
}

const names: PayNames = {
  member: (memberId) => ({
    name: memberId === LEA_MEMBER ? 'Léa' : 'Théo',
    color: null,
    manager: memberId === LEA_MEMBER,
    userId: memberId === LEA_MEMBER ? LEA_USER : 'user_theo',
    left: false,
  }),
  account: () => null,
  members: [],
};

describe('Commissions › « J’ai été décisif sur une vente » (trou 15)', () => {
  it('suit ses signalements et en envoie un sur un shift choisi, avec sa note', async () => {
    mine = MySaleClaimsSchema.parse({
      claims: [claimOf(1, S1, 'not_retained', 'La vente est arrivée avant ton shift')],
      shifts: [S3, S2],
    });
    show(<MySaleClaimsPanel />);
    await waitFor(() => {
      expect(screen.getByText('Pas retenu')).toBeTruthy();
    });
    expect(text()).toContain('Pas retenu : « La vente est arrivée avant ton shift »');
    expect(text()).toContain('Nora Vidal · @nora sur Reveal · sam. 21 nov. · 14 h 05 – 20 h 05');
    fireEvent.click(screen.getByRole('button', { name: 'Signaler un shift' }));
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Envoyer à mon manager' });
    expect(send.hasAttribute('disabled')).toBe(true);
    fireEvent.click(within(dialog).getByRole('radio', { name: /dim\. 22 nov\./u }));
    fireEvent.change(within(dialog).getByLabelText('Ce qui s’est passé'), {
      target: { value: '  Il a pris le pack après ma relance.  ' },
    });
    fireEvent.click(send);
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.url).toBe('/v1/payroll/sale-claims');
    expect(sent[0]?.body).toMatchObject({ shiftId: S2.shiftId, note: 'Il a pris le pack après ma relance.' });
  });

  it('coupe « Signaler un shift » à trois signalements en attente, et retire celui qui attend', async () => {
    mine = MySaleClaimsSchema.parse({
      claims: [claimOf(1, S1, 'waiting'), claimOf(2, S2, 'waiting'), claimOf(3, S3, 'waiting')],
      shifts: [],
    });
    show(<MySaleClaimsPanel />);
    const ask = await screen.findByRole('button', { name: 'Signaler un shift' });
    expect(ask.hasAttribute('disabled')).toBe(true);
    expect(text()).toContain('Tu as 3 signalements en attente');
    fireEvent.click(screen.getAllByRole('button', { name: 'Retirer' })[0] ?? ask);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer' }));
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]).toEqual({
      url: `/v1/payroll/sale-claims/${claimOf(1, S1, 'waiting').id}/answer`,
      body: { outcome: 'withdrawn', note: null },
    });
  });
});

describe('Paie › Quinzaine › « Signalements de chatteurs » (trou 15)', () => {
  beforeEach(() => {
    pending = PendingSaleClaimsSchema.parse({
      claims: [
        { ...claimOf(1, S1, 'waiting'), memberName: 'Théo' },
        { ...claimOf(2, S2, 'waiting', null, LEA_MEMBER), memberName: 'Léa' },
      ],
    });
  });

  it('ouvre les ventes du jour du shift, règle un signalement et refuse l’autre avec un mot', async () => {
    const onShowDay = vi.fn();
    show(
      <SaleClaimsPanel period={NOV16} names={names} me={{ id: 'user_owner' }} reads onShowDay={onShowDay} />,
    );
    await waitFor(() => {
      expect(screen.getByText('Signalements de chatteurs')).toBeTruthy();
    });
    expect(text()).toContain('2 en attente');
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Voir les ventes de ce shift' })[0] ?? document.body,
    );
    expect(onShowDay).toHaveBeenCalledWith('2026-11-21');

    fireEvent.click(screen.getAllByRole('button', { name: 'Réglé' })[0] ?? document.body);
    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]?.body).toEqual({ outcome: 'settled', note: null });

    fireEvent.click(screen.getAllByRole('button', { name: 'Pas retenu' })[1] ?? document.body);
    const dialog = await screen.findByRole('dialog');
    const send = within(dialog).getByRole('button', { name: 'Envoyer' });
    expect(send.hasAttribute('disabled')).toBe(true);
    fireEvent.change(within(dialog).getByLabelText('Pourquoi'), { target: { value: 'Vente de l’IA' } });
    fireEvent.click(send);
    await waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    expect(sent[1]?.body).toEqual({ outcome: 'not_retained', note: 'Vente de l’IA' });
  });

  it('montre au manager son propre signalement sans geste, et rien à un chatteur', async () => {
    show(<SaleClaimsPanel period={NOV16} names={names} me={{ id: LEA_USER }} reads onShowDay={null} />);
    await waitFor(() => {
      expect(text()).toContain('Le tien : un autre valideur y répond.');
    });
    expect(screen.getAllByRole('button', { name: 'Réglé' })).toHaveLength(1);
    cleanup();
    show(
      <SaleClaimsPanel
        period={NOV16}
        names={names}
        me={{ id: 'user_theo' }}
        reads={false}
        onShowDay={null}
      />,
    );
    expect(document.body.textContent).toBe('');
  });
});
