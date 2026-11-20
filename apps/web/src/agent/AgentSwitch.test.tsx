// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSwitch } from './AgentSwitch';
import type { AgentStateInput } from './state';

// Everything below is invented (ADR 0010).
const CREATOR = '0192f3a0-0000-7000-8000-0000000000a1';
const PARIS = 'Europe/Paris';

const on: AgentStateInput = {
  mode: 'copilot',
  globalStop: false,
  pausedUntil: null,
  hoursNow: { open: true, changesAt: null },
  resumesAs: 'copilot',
};

function show(state: AgentStateInput, readOnly = false): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AgentSwitch
        creatorId={CREATOR}
        creatorName="Anna"
        zone={PARIS}
        state={state}
        read={1}
        variant="header"
        readOnly={readOnly}
      />
    </QueryClientProvider>,
  );
}

/** The bodies sent to `PUT /v1/agent/mode`, answered with `answer`. */
function serve(answer: { status: number; body: unknown }): unknown[] {
  const sent: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init?: RequestInit) => {
      sent.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
      return Promise.resolve(new Response(JSON.stringify(answer.body), { status: answer.status }));
    }),
  );
  return sent;
}

const stopped = { status: 200, body: { mode: 'stop', globalStop: false, pausedUntil: null } };

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  // Thursday 19/11/2026, 16:30 in Paris.
  vi.setSystemTime(new Date('2026-11-19T15:30:00Z'));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('AgentSwitch (ADR 0148 § 1)', () => {
  it('pauses for an hour: an Arrêt with its end, sent to the server', async () => {
    const sent = serve(stopped);
    show(on);
    expect(screen.getByText('IA active · Copilote')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(await screen.findByRole('button', { name: /^1\s+h, jusqu’à 17\s+h\s+30/u }));
    await waitFor(() => {
      expect(sent).toEqual([{ creatorId: CREATOR, mode: 'stop', until: '2026-11-19T16:30:00.000Z' }]);
    });
  });

  it('pauses until 9:00 tomorrow on her clock', async () => {
    const sent = serve(stopped);
    show(on);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Jusqu’à demain 9\s+h$/u }));
    await waitFor(() => {
      expect(sent).toEqual([{ creatorId: CREATOR, mode: 'stop', until: '2026-11-20T08:00:00.000Z' }]);
    });
  });

  it('cuts only once confirmed, and says what stays', async () => {
    const sent = serve(stopped);
    show(on);
    fireEvent.click(screen.getByRole('button', { name: 'Couper' }));
    expect(await screen.findByText('Les chatteurs reprennent dans Reveal comme avant.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(sent).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Couper' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Couper l’IA' }));
    await waitFor(() => {
      expect(sent).toEqual([{ creatorId: CREATOR, mode: 'stop' }]);
    });
  });

  it('a pause says when it lifts, and « Rallumer » gives back the mode she had', async () => {
    const sent = serve({ status: 200, body: { mode: 'auto', globalStop: false, pausedUntil: null } });
    show({ ...on, mode: 'stop', pausedUntil: '2026-11-19T17:00:00Z', resumesAs: 'auto' });
    expect(screen.getByText('IA en pause')).toBeDefined();
    expect(screen.getByText(/^reprend seule à 18\s+h, en Automatique$/u)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Rallumer' }));
    await waitFor(() => {
      expect(sent).toEqual([{ creatorId: CREATOR, mode: 'auto' }]);
    });
  });

  it('says why the server kept the pause off', async () => {
    serve({
      status: 409,
      body: {
        error: {
          code: 'agent_pause_conflict',
          message: 'x',
          details: { reason: 'stopped' },
          requestId: 'r1',
        },
      },
    });
    show(on);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(await screen.findByRole('button', { name: /^1\s+h/u }));
    expect(
      await screen.findByText(
        'La pause n’a pas été posée : l’IA est déjà coupée sans fin. Rallume-la d’abord.',
      ),
    ).toBeDefined();
  });

  it('out of her hours, no pause that would end before she opens again (avis Design, 19/11)', async () => {
    serve(stopped);
    // She opens at 21:00 tonight: only « demain 9 h » is offered.
    show({ ...on, hoursNow: { open: false, changesAt: '2026-11-19T20:00:00Z' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(await screen.findByRole('button', { name: /^Jusqu’à demain 9\s+h$/u })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^1\s+h/u })).toBeNull();
    cleanup();
    // She opens only tomorrow at 11:00: nothing to pause.
    show({ ...on, hoursNow: { open: false, changesAt: '2026-11-20T10:00:00Z' } });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Couper' })).toBeDefined();
  });

  it('the global switch is said, never lifted from here; a reader without the right gets no gesture', () => {
    show({ ...on, mode: 'stop', globalStop: true });
    expect(screen.getByText('IA coupée pour toute l’agence')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    show(on, true);
    expect(screen.getByText('IA active · Copilote')).toBeDefined();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
