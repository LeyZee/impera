// @vitest-environment jsdom
import { MyShiftSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MyReviewCard, verdict } from './MyReviewCard';

/* Invented shift, faults and words only (ADR 0010). */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';
const SHIFT = '0192f3a0-0000-7000-8000-0000000000d1';
const shift = MyShiftSchema.parse({
  id: SHIFT,
  creatorId: CREATOR,
  platformAccountId: '0192f3a0-0000-7000-8000-0000000000e1',
  memberId: '0192f3a0-0000-7000-8000-0000000000f1',
  startsAt: '2026-11-25T17:00:00.000Z',
  endsAt: '2026-11-25T23:00:00.000Z',
  templateId: null,
  stoppedAt: null,
  checkedInAt: null,
  creatorName: 'Nora',
  platform: 'reveal',
  handle: 'nora',
  accessStartsAt: '2026-11-25T16:45:00.000Z',
  accessEndsAt: '2026-11-25T23:15:00.000Z',
});
let n = 0;
const card = (patch: Record<string, unknown> = {}) => {
  n += 1;
  return {
    remarkId: `0192f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`,
    kind: 'fault',
    faultCode: 'fault.example_one',
    label: 'Trois médias payants d’affilée',
    tone: 'firm',
    counted: 2,
    occurredAt: '2026-11-25T20:12:00.000Z',
    fanFeeling: 'Il s’est senti comme un portefeuille.',
    missed: { minor: 2500, currency: 'EUR', source: 'script_step' },
    earned: null,
    excerpt: [
      {
        messageId: `0192f3a0-0000-7000-8000-${String(n + 100).padStart(12, '0')}`,
        from: 'chatter',
        text: 'Tu regardes pas ?',
        at: '2026-11-25T20:12:00.000Z',
      },
    ],
    alternative: ['Alors… elle te plaît ?', 'J’en ai une autre, plus osée.'],
    ruleRef: 'rule.example_one',
    contest: null,
    ...patch,
  };
};

function serve(review: unknown) {
  const fetcher = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve(
      init?.method === 'POST'
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(review), { status: 200 }),
    ),
  );
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MyReviewCard shift={shift} zone="Europe/Paris" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('« Mon bilan » (ADR 0170 §§ 26 to 30)', () => {
  it('says what matters first, the missed amount in euros, then each card, and records that he saw it', async () => {
    const fetcher = serve({
      shiftId: SHIFT,
      creatorId: CREATOR,
      faults: [card({ tone: 'grave', missed: null, label: 'Une vidéo perso promise' }), card()],
      wellDone: [
        card({
          kind: 'well_done',
          faultCode: null,
          label: null,
          tone: null,
          missed: null,
          earned: { minor: 4000, currency: 'EUR' },
          alternative: [],
          fanFeeling: 'Il a écrit la scène avec toi.',
        }),
      ],
      missedTotals: [{ minor: 2500, currency: 'EUR' }],
    });
    show();
    expect(
      await screen.findByText(
        /Environ 25,00\s€ laissés sur la table, et une faute grave à ne pas refaire\./u,
      ),
    ).toBeTruthy();
    expect(screen.getByText('Faute grave')).toBeTruthy();
    expect(screen.getByText('Sa confiance')).toBeTruthy();
    expect(screen.getByText('Rappel ferme')).toBeTruthy();
    expect(screen.getByText('2e fois en deux semaines')).toBeTruthy();
    expect(screen.getAllByText('Comment tu aurais pu la mener')).toHaveLength(2);
    expect(screen.getByText(/\+ 40,00\s€/u)).toBeTruthy();
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        `/v1/team/review/shifts/${SHIFT}/seen`,
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ creatorId: CREATOR }) }),
      );
    });
  });

  it('contests a point in one line', async () => {
    const fault = card();
    const fetcher = serve({
      shiftId: SHIFT,
      creatorId: CREATOR,
      faults: [fault],
      wellDone: [],
      missedTotals: [],
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Je conteste' }));
    fireEvent.change(screen.getByLabelText('Pourquoi, en une ligne'), {
      target: { value: 'Il avait dit non' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }));
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledWith(
        `/v1/team/review/remarks/${fault.remarkId}/contest`,
        expect.objectContaining({ body: JSON.stringify({ creatorId: CREATOR, reason: 'Il avait dit non' }) }),
      );
    });
  });

  it('shows nothing for a shift without remarks', async () => {
    const fetcher = serve({ shiftId: SHIFT, creatorId: CREATOR, faults: [], wellDone: [], missedTotals: [] });
    show();
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalled();
    });
    expect(screen.queryByText(/Mon bilan/u)).toBeNull();
  });

  it('writes a verdict without forcing a compliment', () => {
    expect(verdict([], null)).toBe('Rien à reprendre sur ce shift.');
  });
});
