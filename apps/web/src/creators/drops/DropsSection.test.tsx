// @vitest-environment jsdom
import { ContentDropIdSchema, CreatorIdSchema, type DropDescriptionsReview } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DropsSection } from './DropsSection';

import { reviewOf } from '@/creators/scripts/fixtures';
import { dropOf, fileOf, requestOf } from '@/screens/content/fixtures';

/* An invented creator and drops (ADR 0010). */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const SEANCE = dropOf({
  id: ContentDropIdSchema.parse('0192f3a0-0000-7000-8000-000000000d01'),
  category: 'feed_shoot',
  sentence: 'Au salon, inventé',
  files: [fileOf({ bytes: 3_000_000 }), fileOf({ bytes: 3_000_000 })],
  createdAt: '2026-11-09T10:00:00.000Z',
});
const SCRIPT = dropOf({
  category: 'script',
  scriptNumber: 1,
  requestId: requestOf({ category: 'script' }).id,
});
const PUBLISHED = { ...SEANCE, exportedAt: '2026-11-11T09:00:00.000Z' };

interface Reply {
  readonly status: number;
  readonly body?: unknown;
}

function serve(routes: Record<string, (body: unknown) => Reply>): { method: string; path: string }[] {
  const calls: { method: string; path: string }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const path = url.replace(/^\/v1/u, '');
      calls.push({ method, path });
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      const reply = routes[`${method} ${path}`]?.(body) ?? { status: 404 };
      return Promise.resolve(
        new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status }),
      );
    }),
  );
  return calls;
}

const CONTENT = `GET /creators/${CREATOR}/content`;
const SWITCH = `/creators/${CREATOR}/drop-descriptions`;
const CONFIRM = `POST /creators/${CREATOR}/drops/${SEANCE.id}/export/confirm`;

function show(isOwner = false): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <DropsSection creatorId={CREATOR} creatorName="Lina" timezone="Europe/Paris" isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Créatrices › Contenu (recette créatrice 1 et 6)', () => {
  it('shows her séance, never her script, with its archive to download and « Publié sur Reveal »', async () => {
    serve({ [CONTENT]: () => ({ status: 200, body: { requests: [], drops: [SEANCE, SCRIPT] } }) });
    show();
    const card = await screen.findByRole('listitem', { name: 'Feed · Séance boudoir' });
    expect(within(card).getByText('À publier')).toBeDefined();
    expect(within(card).getByText('« Au salon, inventé »')).toBeDefined();
    expect(within(card).getByText(/Déposé le 9 novembre · 2 photos · 6 Mo/u)).toBeDefined();
    expect(within(card).getByRole('link', { name: 'Télécharger l’archive' }).getAttribute('href')).toBe(
      `/v1/creators/${CREATOR}/drops/${SEANCE.id}/export`,
    );
    expect(screen.getByText('1 dépôt · 1 à publier')).toBeDefined();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('confirms it out once, in a dialog that says the originals go in 30 days', async () => {
    let drops = [SEANCE];
    const calls = serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [], drops } }),
      [CONFIRM]: () => {
        drops = [PUBLISHED];
        return { status: 200, body: PUBLISHED };
      },
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Feed · Séance boudoir' });
    fireEvent.click(within(card).getByRole('button', { name: 'Publié sur Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Publié sur Reveal ?' });
    expect(within(dialog).getByText(/publié sur son feed Reveal/u)).toBeDefined();
    expect(within(dialog).getByText(/Ses originaux partent alors dans 30/u)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirmer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const after = await screen.findByText('1 dépôt · tous publiés');
    expect(after).toBeDefined();
    expect(
      screen.getByText(/Confirmé le 11 novembre\. Ses originaux partent au plus tard le 11 décembre/u),
    ).toBeDefined();
    expect(screen.getByRole('link', { name: 'Télécharger à nouveau' })).toBeDefined();
    expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
  });

  it('reads her media and their descriptions as one list, without steps nor synthesis', async () => {
    const files = [
      '0192f3a0-0000-7000-8000-000000000b01',
      '0192f3a0-0000-7000-8000-000000000b02',
      '0192f3a0-0000-7000-8000-000000000b03',
    ] as const;
    const review: DropDescriptionsReview = { ...reviewOf(SEANCE.id, files), steps: [], summary: null };
    serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [], drops: [SEANCE] } }),
      [`GET /creators/${CREATOR}/drops/${SEANCE.id}/descriptions`]: () => ({ status: 200, body: review }),
    });
    show();
    const card = await screen.findByRole('listitem', { name: 'Feed · Séance boudoir' });
    fireEvent.click(within(card).getByRole('button', { name: 'Relire les descriptions' }));
    const region = await screen.findByRole('region', { name: 'Descriptions de Feed · Séance boudoir' });
    expect(within(region).getByText('3 descriptions à valider')).toBeDefined();
    expect(within(region).queryByText('Synthèse')).toBeNull();
    expect(within(region).getByRole('button', { name: 'Tout valider' })).toBeDefined();
    expect(within(region).getAllByText(/Photo inventée/u)).toHaveLength(3);
  });

  it('gives the owner alone her switch; turned on, it says so (recette créatrice 6)', async () => {
    let on = false;
    const calls = serve({
      [CONTENT]: () => ({ status: 200, body: { requests: [], drops: [SEANCE] } }),
      [`GET ${SWITCH}`]: () => ({ status: 200, body: { on } }),
      [`PUT ${SWITCH}`]: () => {
        on = true;
        return { status: 200, body: { on } };
      },
    });
    show(true);
    const toggle = await screen.findByRole('switch', { name: 'Descriptions par l’IA' });
    if (!(toggle instanceof HTMLInputElement)) throw new Error('the switch is an input');
    await waitFor(() => {
      expect(toggle.disabled).toBe(false);
    });
    expect(toggle.checked).toBe(false);
    expect(screen.getByText(/Éteint : ses médias ne sont pas décrits/u)).toBeDefined();
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(toggle.checked).toBe(true);
    });
    expect(screen.getByText(/Chaque photo et vidéo de Lina est décrite/u)).toBeDefined();
    expect(calls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    cleanup();
    const asManager = serve({ [CONTENT]: () => ({ status: 200, body: { requests: [], drops: [SEANCE] } }) });
    show(false);
    await screen.findByRole('listitem', { name: 'Feed · Séance boudoir' });
    expect(screen.queryByRole('switch')).toBeNull();
    expect(asManager.some((call) => call.path === SWITCH)).toBe(false);
  });

  it('says when she has dropped nothing but scripts', async () => {
    serve({ [CONTENT]: () => ({ status: 200, body: { requests: [], drops: [SCRIPT] } }) });
    show();
    expect(await screen.findByText('Aucun dépôt')).toBeDefined();
  });
});
