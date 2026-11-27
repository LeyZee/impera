// @vitest-environment jsdom
import type { FirstSteps, Me } from '@impera/contracts';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { clearCodesUnconfirmed, codesUnconfirmed } from './auth/codes-pending';

/** An invented chatter and ten invented codes shaped like the server's. */
const THEO: Me = {
  id: 'u-chatter',
  email: 'chatter@example.test',
  name: 'Théo',
  role: 'operator',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
  preferences: { sounds: true },
};
const CODES = Array.from({ length: 10 }, (_, i) => `code${String(i)}-inven`);

/** The session of an account at its first steps; `codes`: what the server still shows of its backup codes. */
function serve(firstSteps: FirstSteps | undefined, codes: readonly string[] | null = null): string[] {
  const calls: string[] = [];
  vi.stubGlobal('scrollTo', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      if (input === '/v1/session') {
        return Promise.resolve(
          Response.json({
            state: 'signed_in',
            me: THEO,
            ...(firstSteps === undefined ? {} : { firstSteps }),
          }),
        );
      }
      if (input.startsWith('/v1/me/first-steps/')) {
        calls.push(input);
        if (!input.endsWith('/backup-codes')) return Promise.resolve(new Response(null, { status: 204 }));
        return Promise.resolve(
          codes === null
            ? new Response('{}', { status: 410 })
            : Response.json({ backupCodes: codes, shownUntil: '2026-11-27T10:09:00.000Z' }),
        );
      }
      // The screens stay on their loading state: only what comes before them is under test.
      return new Promise<Response>(() => undefined);
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearCodesUnconfirmed();
  window.history.replaceState(null, '', '/');
});

describe('App at an account’s first steps (recette 27/11, A8)', () => {
  it('shows the welcome until it was seen, even after a reload, and says it seen once', async () => {
    const calls = serve({ codesKept: true, welcomed: false });
    render(<App />);
    expect(await screen.findByText('Bienvenue, Théo')).toBeDefined();
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Plus tard' }));
    expect(calls).toEqual(['/v1/me/first-steps/welcomed']);
    expect(screen.queryByText('Bienvenue, Théo')).toBeNull();
  });

  it('shows no welcome to an account that saw it, nor to an answer that does not say', async () => {
    serve({ codesKept: true, welcomed: true });
    render(<App />);
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(screen.queryByText('Bienvenue, Théo')).toBeNull();
    cleanup();
    serve(undefined);
    render(<App />);
    await vi.waitFor(() => {
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(screen.queryByText('Bienvenue, Théo')).toBeNull();
  });

  it('shows the backup codes again after a reload left them unsaid, then the welcome', async () => {
    const calls = serve({ codesKept: false, welcomed: false }, CODES);
    render(<App />);
    const list = await screen.findByLabelText('Codes de secours');
    expect(list.querySelectorAll('li')).toHaveLength(10);
    // Why they are back, and until when (in amber, a warning).
    const note = screen.getByRole('status');
    expect(note.textContent).toMatch(/Ils restent affichés jusqu’à \d\d:\d\d/u);
    expect(note.className).toContain('nv-note--warn');
    // Never « ils ne seront plus affichés » beside « ils restent affichés » (Design, 27/11).
    expect(screen.queryByText(/Ils ne seront plus affichés/u)).toBeNull();
    expect(screen.queryByText('Bienvenue, Théo')).toBeNull();
    const enter = screen.getByRole('button', { name: 'Ouvrir Impera' });
    expect(enter).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByLabelText('J’ai mis ces codes en lieu sûr.'));
    fireEvent.click(enter);
    expect(await screen.findByText('Bienvenue, Théo')).toBeDefined();
    expect(calls).toEqual(['/v1/me/first-steps/backup-codes', '/v1/me/first-steps/codes-kept']);
    expect(codesUnconfirmed()).toBe(false);
  });

  it('opens the app when the server no longer shows them, and leaves the word to Sécurité', async () => {
    const calls = serve({ codesKept: false, welcomed: true }, null);
    render(<App />);
    await vi.waitFor(() => {
      expect(calls).toEqual(['/v1/me/first-steps/backup-codes']);
      expect(document.querySelector('[aria-busy="true"]')).toBeNull();
    });
    expect(screen.queryByLabelText('Codes de secours')).toBeNull();
    expect(codesUnconfirmed()).toBe(true);
  });
});
