// @vitest-environment jsdom
import { CreatorIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScriptsSection } from './ScriptsSection';
import { structureOf } from './fixtures';

import { dropOf, fileOf, requestOf } from '@/screens/content/fixtures';

/* An invented creator, structure and scripts (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const NIGHT = structureOf('0192f3a0-0000-7000-8000-000000000a01', 'Soirée inventée', 'night');
const REQUEST = requestOf({ category: 'script', structureId: NIGHT.id, moment: 'night' });
const SENT = dropOf({
  category: 'script',
  scriptNumber: 12,
  requestId: REQUEST.id,
  files: [fileOf({ slotKey: 'salon::0' })],
});
const COPIED = { ...SENT, exportedAt: '2026-11-06T15:00:00.000Z' };

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

/** A fake `/v1`: each `METHOD path` answered by its route, every call kept. */
function serve(routes: Record<string, () => Reply>): { method: string; path: string }[] {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '');
      calls.push({ method, path });
      const reply = routes[`${method} ${path}`]?.() ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const CONTENT = `GET /creators/${CREATOR}/content`;
const STRUCTURES = 'GET /script-structures';
const CONFIRM = `POST /creators/${CREATOR}/drops/${SENT.id}/script-export/confirm`;

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScriptsSection creatorId={CREATOR} creatorName="Lina" timezone="Europe/Paris" />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Scripts (SC-03 c2b)', () => {
  it('shows a sent script by its number and moment, with its archive to download', async () => {
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [REQUEST], drops: [SENT] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Soirée inventée' });
    expect(within(card).getByText('S012')).toBeDefined();
    expect(within(card).getByText('Nuit')).toBeDefined();
    expect(within(card).getByText('À recopier')).toBeDefined();
    expect(within(card).getByRole('link', { name: 'Télécharger l’archive' }).getAttribute('href')).toBe(
      `/v1/creators/${CREATOR}/drops/${SENT.id}/script-export`,
    );
    expect(screen.getByText('1 script · 1 à recopier')).toBeDefined();
  });

  it('counts « à recopier » only what can be copied now, and gives the neon to the next one alone', async () => {
    const next = { ...SENT, id: '0192f3a0-0000-7000-8000-000000000d02', scriptNumber: 13 };
    const checking = {
      ...SENT,
      id: '0192f3a0-0000-7000-8000-000000000d03',
      scriptNumber: 14,
      state: 'received',
    };
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [REQUEST], drops: [SENT, next, checking] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
    });
    show();
    expect(await screen.findByText('3 scripts · 2 à recopier')).toBeDefined();
    const confirms = screen.getAllByRole('button', { name: 'Copié dans Reveal' });
    expect(confirms.map((button) => button.classList.contains('nv-btn--neon'))).toEqual([true, false]);
  });

  it('confirms the copy behind a dialog, then reads it copied with the date her originals go', async () => {
    let copied = false;
    const calls = serve({
      [CONTENT]: () => ({
        status: 200,
        body: { requests: [REQUEST], drops: [copied ? COPIED : SENT] },
      }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
      [CONFIRM]: () => {
        copied = true;
        return { status: 200, body: COPIED };
      },
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Soirée inventée' });
    fireEvent.click(within(card).getByRole('button', { name: 'Copié dans Reveal' }));
    const dialog = screen.getByRole('dialog', { name: 'Copié dans Reveal ?' });
    expect(within(dialog).getByText(/partent alors dans 30 jours/u)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmer la copie' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(
      await screen.findByText('Copié le 6 novembre. Ses originaux partent au plus tard le 6 décembre.'),
    ).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Copié dans Reveal' })).toBeNull();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('says the server’s refusal in the dialog, and keeps it open', async () => {
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [REQUEST], drops: [SENT] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [NIGHT] } }),
      [CONFIRM]: () => ({
        status: 422,
        body: {
          error: {
            code: 'content_drop_export_unprocessable',
            message: 'Un original de ce script est déjà effacé',
            details: { reason: 'original_erased' },
            requestId: 'r1',
          },
        },
      }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Copié dans Reveal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer la copie' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Un original de ce script est déjà effacé.');
    expect(screen.getByRole('dialog')).toBeDefined();
  });

  it('offers no archive for a « Jour et nuit » script asked before its moment was fixed', async () => {
    const both = structureOf('0192f3a0-0000-7000-8000-000000000a02', 'Week-end inventé', 'both');
    const request = { ...REQUEST, structureId: both.id, moment: null };
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [request], drops: [SENT] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [both] } }),
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Week-end inventé' });
    expect(within(card).getByText('Archive impossible')).toBeDefined();
    expect(within(card).queryByRole('link')).toBeNull();
  });

  it('says when she has sent none yet, and when her content does not load', async () => {
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [], drops: [] } }),
      [STRUCTURES]: () => ({ status: 200, body: { structures: [] } }),
    });
    show();
    expect(await screen.findByText('Aucun script envoyé')).toBeDefined();
    cleanup();
    serve({});
    show();
    expect(await screen.findByText('Ses scripts ne se chargent pas')).toBeDefined();
  });
});
