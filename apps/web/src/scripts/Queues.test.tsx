// @vitest-environment jsdom
import {
  CreatorIdSchema,
  SCRIPT_STARTERS,
  ScriptQueueBodySchema,
  ScriptStructureIdSchema,
  ScriptStructureVersionIdSchema,
  type CreatorSummary,
  type ScriptQueue,
  type ScriptStructure,
  type ScriptStructureId,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Queues } from './Queues';

/* Invented creators and structures: no real data. */
const CREATOR: CreatorSummary = {
  id: CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1'),
  displayName: 'Zoé',
  timezone: 'Europe/Paris',
};
const SOFT = ScriptStructureIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const HARSH = ScriptStructureIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a2');

const NAMES = new Map<ScriptStructureId, string>();

function structure(id: ScriptStructureId, name: string): ScriptStructure {
  NAMES.set(id, name);
  const starter = SCRIPT_STARTERS[0];
  if (starter === undefined) throw new Error('no starter');
  return {
    id,
    reservedCreatorId: null,
    createdAt: '2026-11-03T10:00:00.000Z',
    current: {
      ...starter.body,
      name,
      id: ScriptStructureVersionIdSchema.parse(id.replace(/a(\d)$/u, 'b$1')),
      version: 1,
      frozen: false,
      updatedAt: '2026-11-03T10:00:00.000Z',
    },
  };
}
const LIBRARY = [structure(SOFT, 'Douceur'), structure(HARSH, 'Dur')];

const view = (ids: readonly ScriptStructureId[], personaChecked = true): ScriptQueue => ({
  creatorId: CREATOR.id,
  personaChecked,
  entries: ids.map((id) => ({
    structureId: id,
    name: NAMES.get(id) ?? 'Structure',
    moment: 'both',
    version: 1,
    blocks: [],
  })),
});

/** Her queue on the server: a PUT holding `HARSH` is refused, as a disgust would refuse it. */
function serve(start: readonly ScriptStructureId[], personaChecked = true): { puts: ScriptStructureId[][] } {
  let stored = [...start];
  const calls: { puts: ScriptStructureId[][] } = { puts: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe(`/v1/creators/${CREATOR.id}/script-queue`);
      if (init?.method !== 'PUT') {
        return Promise.resolve(new Response(JSON.stringify(view(stored, personaChecked)), { status: 200 }));
      }
      const { structureIds } = ScriptQueueBodySchema.parse(
        JSON.parse(typeof init.body === 'string' ? init.body : 'null'),
      );
      calls.puts.push(structureIds);
      if (structureIds.includes(HARSH)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'script_queue_disgust_unprocessable',
                message: 'x',
                details: {
                  refusals: [
                    { structureId: HARSH, blocks: [{ key: 'dur', stageName: 'Dur', term: 'Brutal' }] },
                  ],
                },
                requestId: 'r',
              },
            }),
            { status: 422 },
          ),
        );
      }
      stored = structureIds;
      return Promise.resolve(new Response(JSON.stringify(view(stored, personaChecked)), { status: 200 }));
    }),
  );
  return calls;
}

function renderQueues(): void {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Queues creators={[CREATOR]} structures={LIBRARY} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the queue of a creator', () => {
  it('says in amber when her limits could not be read', async () => {
    serve([SOFT], false);
    renderQueues();
    expect(await screen.findByText(/Pas de persona active/u)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retirer Douceur de sa file' })).toBeTruthy();
  });

  it('adds a structure at once, and shows the stage and her entry when the server refuses it', async () => {
    const calls = serve([SOFT]);
    renderQueues();
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter Dur à sa file' }));
    expect(await screen.findByText('Refusée : « Dur » touche « Brutal » dans sa persona')).toBeTruthy();
    expect(calls.puts).toEqual([[SOFT, HARSH]]);
    // Nothing written: her queue is still the one stored.
    expect(screen.queryByRole('button', { name: 'Retirer Dur de sa file' })).toBeNull();
  });

  it('removes a structure from her queue and writes it', async () => {
    const calls = serve([SOFT]);
    renderQueues();
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer Douceur de sa file' }));
    await waitFor(() => {
      expect(calls.puts).toEqual([[]]);
    });
    expect(await screen.findByText(/Rien dans sa file/u)).toBeTruthy();
  });

  it('moves a structure with Alt and the arrows, then writes the order once it settles', async () => {
    const calls = serve([SOFT]);
    // A second structure, kept by no one, joins: then it goes up.
    const second = structure(ScriptStructureIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a3'), 'Tendre');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <Queues creators={[CREATOR]} structures={[...LIBRARY, second]} />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Ajouter Tendre à sa file' }));
    await waitFor(() => {
      expect(calls.puts).toEqual([[SOFT, second.id]]);
    });
    fireEvent.keyDown(await screen.findByLabelText('2. Tendre'), { key: 'ArrowUp', altKey: true });
    await waitFor(
      () => {
        expect(calls.puts.at(-1)).toEqual([second.id, SOFT]);
      },
      { timeout: 2000 },
    );
  });
});
