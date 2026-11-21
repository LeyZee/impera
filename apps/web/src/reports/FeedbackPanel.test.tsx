// @vitest-environment jsdom
import { ShiftReportContextSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeedbackPanel } from './FeedbackPanel';

/* Invented people (ADR 0010). Now: 01:00 on 28 October in Paris; the shift ended at 23:00 the day before. */
const id = (n: number): string => `0199f2a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const SHIFT = id(101);

const context = ShiftReportContextSchema.parse({
  shift: {
    id: SHIFT,
    creatorId: id(1),
    platformAccountId: id(11),
    memberId: id(21),
    startsAt: '2026-10-27T16:00:00.000Z',
    endsAt: '2026-10-27T22:00:00.000Z',
    templateId: null,
    stoppedAt: null,
    checkedInAt: null,
  },
  account: {
    id: id(11),
    creatorId: id(1),
    creatorName: 'Nora Vidal',
    platform: 'reveal',
    handle: 'nora',
    archived: false,
  },
  period: '2026-10-16',
  opensAt: '2026-10-27T21:30:00.000Z',
  rules: { currency: 'EUR', earningsSource: 'detected' },
  reports: [],
});

const sent = (patch: Record<string, unknown>): Record<string, unknown> => ({
  id: id(501),
  shiftId: SHIFT,
  creatorId: id(1),
  platformAccountId: id(11),
  memberId: id(21),
  period: '2026-10-16',
  nothingToReport: false,
  comment: null,
  incident: null,
  signals: [],
  incidentSeenAt: null,
  incidentResolvedAt: null,
  createdAt: '2026-10-27T22:05:00.000Z',
  ...patch,
});

let stored: Record<string, unknown> | null;
const writes: { method: string; path: string; body: Record<string, unknown> }[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const json = (body: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(body), { status }));
      if (init?.method === 'PUT') {
        const body: unknown = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        if (typeof body !== 'object' || body === null) return json(null, 400);
        writes.push({ method: init.method, path: url.pathname, body: { ...body } });
        stored = sent({ ...body });
        return json(stored, 201);
      }
      if (url.pathname === `/v1/scheduling/shifts/${SHIFT}/feedback`) return json({ feedback: stored });
      return json(null, 404);
    }),
  );
}

function renderPanel(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <FeedbackPanel data={context} zone="Europe/Paris" onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date('2026-10-28T00:00:00Z'));
  stored = null;
  writes.length = 0;
  serve();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Mon retour de fin de shift (ADR 0050 § 10, trous béants n° 1)', () => {
  it('says « Rien à signaler » in one gesture, with no amount asked', async () => {
    renderPanel();
    const send = await screen.findByRole('button', { name: 'Rien à signaler' });
    expect(screen.queryByLabelText('Ce que tu as généré')).toBe(null);
    fireEvent.click(send);
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]).toMatchObject({
      path: `/v1/scheduling/shifts/${SHIFT}/feedback`,
      body: { nothingToReport: true, comment: null, incident: null, signals: [] },
    });
    expect(await screen.findByText('Rien à signaler, envoyé')).toBeTruthy();
  });

  it('sends an incident and what the week misses, each signal with its category', async () => {
    renderPanel();
    await screen.findByRole('button', { name: 'Rien à signaler' });
    fireEvent.click(screen.getByRole('switch'));
    // An empty incident is said, never sent.
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon retour' }));
    expect(await screen.findByText('Dis en une phrase ce qui s’est passé.')).toBeTruthy();
    expect(writes).toEqual([]);

    fireEvent.change(screen.getByLabelText('Ce qui s’est passé'), {
      target: { value: 'Un fan menace de signaler le compte' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une remontée' }));
    fireEvent.click(screen.getByRole('button', { name: 'Contenu manquant' }));
    fireEvent.change(screen.getByLabelText('Ce que signale la remontée 1'), {
      target: { value: 'Une vidéo en extérieur' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer mon retour' }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    expect(writes[0]?.body).toMatchObject({
      nothingToReport: false,
      incident: 'Un fan menace de signaler le compte',
      signals: [{ category: 'missing_content', text: 'Une vidéo en extérieur' }],
    });
    expect(await screen.findByText('Incident signalé')).toBeTruthy();
    expect(screen.getByText('L’agence a été prévenue sur son téléphone.')).toBeTruthy();
  });

  it('shows where a sent incident stands: « Vu » by the agency, its second step the current one', async () => {
    stored = sent({ incident: 'Coupure de connexion', incidentSeenAt: '2026-10-27T23:10:00.000Z' });
    renderPanel();
    const steps = await screen.findByRole('list', { name: 'Incident : Vu' });
    expect(within(steps).getAllByRole('listitem')[1]?.getAttribute('aria-current')).toBe('step');
    expect(screen.getByText('L’agence l’a vu et s’en occupe.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Rien à signaler' })).toBe(null);
  });
});
