// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CorrectionsPanel } from './CorrectionsPanel';

const CREATOR = '0199f2a0-0000-7000-8000-0000000000c1';
const FIRST = '0199f2a0-0000-7000-8000-00000000c0f1';
const SECOND = '0199f2a0-0000-7000-8000-00000000c0f2';

/** Invented corrections (ADR 0010). */
let corrections: { id: string; section: string; text: string; state: string; doneAt: string | null }[];
const marked: string[] = [];

const row = (id: string, section: string, text: string, state = 'open') => ({
  id,
  section,
  text,
  state,
  createdAt: '2026-11-06T09:00:00.000Z',
  doneAt: state === 'done' ? '2026-11-06T10:00:00.000Z' : null,
});

beforeEach(() => {
  marked.length = 0;
  corrections = [
    row(FIRST, 'tastes', 'Plutôt le thé que le café.'),
    row(SECOND, 'limits', 'Plus de pieds du tout.'),
    row('0199f2a0-0000-7000-8000-00000000c0f3', 'details', 'Déjà traitée.', 'done'),
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = new URL(input, 'http://localhost');
      const done = /\/persona\/corrections\/([^/]+)\/done$/.exec(url.pathname);
      if (done !== null && init?.method === 'POST') {
        const id = done[1] ?? '';
        marked.push(id);
        corrections = corrections.map((one) =>
          one.id === id ? { ...one, state: 'done', doneAt: '2026-11-06T11:00:00.000Z' } : one,
        );
        const after = corrections.find((one) => one.id === id);
        return Promise.resolve(new Response(JSON.stringify(after)));
      }
      if (url.pathname === `/v1/creators/${CREATOR}/persona/corrections`) {
        return Promise.resolve(new Response(JSON.stringify({ corrections })));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderPanel = (canMark: boolean, onShowSection = vi.fn()) => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CorrectionsPanel
        creatorId={CREATOR}
        creatorName="Elena"
        canMark={canMark}
        onShowSection={onShowSection}
      />
    </QueryClientProvider>,
  );
  return onShowSection;
};

describe('CorrectionsPanel (recette CREA-01 b)', () => {
  it('lists the corrections she sent that wait, each opening its section', async () => {
    const onShowSection = renderPanel(true);
    expect(await screen.findByRole('heading', { name: 'Corrections proposées par Elena' })).toBeTruthy();
    expect(screen.getByText('2 à traiter')).toBeTruthy();
    expect(screen.getByText('Plutôt le thé que le café.')).toBeTruthy();
    expect(screen.queryByText('Déjà traitée.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ses limites' }));
    expect(onShowSection).toHaveBeenCalledWith('limits');
  });

  it('lets the owner mark one handled, once, and hides the panel when none waits', async () => {
    renderPanel(true);
    const [first] = await screen.findAllByRole('button', { name: 'Traitée' });
    if (first === undefined) throw new Error('no button');
    fireEvent.click(first);
    fireEvent.click(first);
    expect(await screen.findByText('1 à traiter')).toBeTruthy();
    expect(marked).toEqual([FIRST]);
    expect(screen.queryByText('Plutôt le thé que le café.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Traitée' }));
    await vi.waitFor(() => {
      expect(screen.queryByRole('heading')).toBeNull();
    });
  });

  it('shows a manager the corrections without the button', async () => {
    renderPanel(false);
    expect(await screen.findByText('Plus de pieds du tout.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Traitée' })).toBeNull();
  });
});
