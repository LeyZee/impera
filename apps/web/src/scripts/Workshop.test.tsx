// @vitest-environment jsdom
import {
  CreateScriptStructureBodySchema,
  SCRIPT_STARTERS,
  ScriptCardPreviewBodySchema,
  ScriptStructureIdSchema,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Workshop } from './Workshop';

/* An invented structure id: the starter is the repo's own data, no creator in it. */
const ID = ScriptStructureIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const starter = SCRIPT_STARTERS[0];

interface Calls {
  readonly previews: unknown[];
  readonly posts: unknown[];
}

function serve(): Calls {
  const calls: Calls = { previews: [], posts: [] };
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const body: unknown = JSON.parse(typeof init?.body === 'string' ? init.body : 'null');
      if (url === '/v1/script-structures/cards/preview') {
        calls.previews.push(ScriptCardPreviewBodySchema.parse(body));
        return Promise.resolve(new Response('<svg xmlns="http://www.w3.org/2000/svg"/>', { status: 200 }));
      }
      expect(url).toBe('/v1/script-structures');
      const sent = CreateScriptStructureBodySchema.parse(body);
      calls.posts.push(sent);
      const { id, reservedCreatorId, ...content } = sent;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            id,
            reservedCreatorId,
            createdAt: '2026-11-03T10:00:00.000Z',
            current: {
              ...content,
              id: '0192f3a0-0000-7000-8000-0000000000b1',
              version: 1,
              frozen: false,
              updatedAt: '2026-11-03T10:00:00.000Z',
            },
          }),
          { status: 201 },
        ),
      );
    }),
  );
  return calls;
}

function renderWorkshop(): void {
  if (starter === undefined) throw new Error('no starter');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Workshop
        start={{
          id: ID,
          basedOnVersion: null,
          frozen: false,
          draft: { ...starter.body, reservedCreatorId: null },
        }}
        onClose={() => undefined}
        onDirty={() => undefined}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the workshop of a structure', () => {
  it('draws the card of the stage picked, and of its series', async () => {
    const calls = serve();
    renderWorkshop();
    await waitFor(() => {
      expect(calls.previews).toContainEqual(
        expect.objectContaining({ segmentKey: 'teasing', format: 'card' }),
      );
    });
    expect(await screen.findByAltText('Carton de Étape 1')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Voir le carton de la série B' }));
    await waitFor(() => {
      expect(calls.previews).toContainEqual(expect.objectContaining({ segmentKey: 'teasing', variant: 'B' }));
    });
  });

  it('shuts the save while a field is empty, and says so', () => {
    serve();
    renderWorkshop();
    fireEvent.change(screen.getByLabelText('Nom de la structure'), { target: { value: '' } });
    expect(screen.getByRole('button', { name: 'Enregistrer' })).toHaveProperty('disabled', true);
    expect(screen.getAllByText('Un champ est vide').length).toBeGreaterThan(0);
  });

  it('writes a new structure under its id, with the stage added', async () => {
    const calls = serve();
    renderWorkshop();
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter une étape' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));
    await screen.findByText('Enregistrée, version 1.');
    expect(calls.posts).toHaveLength(1);
    expect(calls.posts[0]).toMatchObject({ id: ID });
    const sent = CreateScriptStructureBodySchema.parse(calls.posts[0]);
    expect(sent.segments.at(-1)).toMatchObject({ kind: 'stage', name: 'Nouvelle étape' });
  });

  it('moves a stage with Alt and the arrows, and drops the bridge it leaves', () => {
    serve();
    renderWorkshop();
    const bridges = (): number => screen.getAllByText(/^Pont \d & \d$/).length;
    const before = bridges();
    const second = screen.getByRole('button', { name: /^Étape 2/ });
    fireEvent.keyDown(second, { key: 'ArrowUp', altKey: true });
    expect(bridges()).toBe(before - 1);
  });
});
