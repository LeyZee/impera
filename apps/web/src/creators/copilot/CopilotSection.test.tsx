// @vitest-environment jsdom
import { SetCopilotSwitchesBodySchema, type CopilotSwitches } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopilotSection } from './CopilotSection';

/* An invented creator: no real person. */
const CREATOR = '0192f3a0-0000-7000-8000-0000000000c1';

/** A fake `/v1/creators/:id/copilot` that keeps the switches and answers with both; `fail` refuses every PUT. */
function serve(start: CopilotSwitches, { fail = false } = {}): unknown[] {
  let switches = start;
  const puts: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/v1/creators/${CREATOR}/copilot`);
      if (init?.method === 'PUT') {
        const body = SetCopilotSwitchesBodySchema.parse(
          JSON.parse(typeof init.body === 'string' ? init.body : 'null'),
        );
        puts.push(body);
        if (fail) return Promise.resolve(new Response(null, { status: 500 }));
        switches = { ...switches, ...body };
      }
      return Promise.resolve(new Response(JSON.stringify(switches), { status: 200 }));
    }),
  );
  return puts;
}

/** Whether a switch is on: the element is the checkbox the role names. */
const checked = (element: HTMLElement): boolean => element instanceof HTMLInputElement && element.checked;

function show(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CopilotSection creatorId={CREATOR} creatorName="Lune" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › IA › Copilote dans l’extension (trous béants, 21/11)', () => {
  it('says first that her chatters write alone while the drafts are off, in the neutral ink', async () => {
    serve({ fanCard: true, drafts: false });
    show();
    const line = await screen.findByText(
      'Brouillons éteints : les chatteurs de Lune écrivent seuls, avec la fiche du fan.',
    );
    expect(line.dataset['tone']).toBe('off');
    expect(checked(screen.getByRole('switch', { name: 'Brouillons de l’IA : éteints' }))).toBe(false);
    expect(checked(screen.getByRole('switch', { name: 'Fiche du fan : allumée' }))).toBe(true);
  });

  it('turns the drafts on at once, the other switch kept, and says what the chatters now get', async () => {
    const puts = serve({ fanCard: true, drafts: false });
    show();
    fireEvent.click(await screen.findByRole('switch', { name: 'Brouillons de l’IA : éteints' }));
    await screen.findByText('Les chatteurs de Lune ont la fiche du fan et les brouillons de l’IA.');
    expect(puts).toEqual([{ drafts: true }]);
    expect(checked(screen.getByRole('switch', { name: 'Brouillons de l’IA : allumés' }))).toBe(true);
  });

  it('keeps the switch as it was and says why when the server refuses', async () => {
    serve({ fanCard: false, drafts: false }, { fail: true });
    show();
    fireEvent.click(await screen.findByRole('switch', { name: 'Fiche du fan : éteinte' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Rien n’a changé. Le serveur ne répond pas. Réessaie dans un instant.',
    );
    await waitFor(() => {
      expect(checked(screen.getByRole('switch', { name: 'Fiche du fan : éteinte' }))).toBe(false);
    });
    expect(screen.getByText(/Copilote éteint/u).dataset['tone']).toBe('off');
  });
});
