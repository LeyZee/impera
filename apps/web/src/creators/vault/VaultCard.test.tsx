// @vitest-environment jsdom
import { CreatorIdSchema, PlatformAccountIdSchema, type VaultView } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VaultCard } from './VaultCard';

/* An invented creator and vault (ADR 0010): no real creator, no real media. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const media = (kind: 'image' | 'video', removed = false) => ({
  platformMediaId: `m-${kind}-${String(Math.random())}`,
  kind,
  durationSeconds: kind === 'video' ? 12 : null,
  uploadedAt: '2026-11-10T10:00:00.000Z',
  platformDescription: null,
  suggestedPriceMinor: null,
  removed,
});
const folder = (
  ref: string | null,
  name: string | null,
  moment: 'day' | 'night' | null,
  items = [media('image')],
) => ({
  platform: 'reveal' as const,
  platformAccountId: ACCOUNT,
  folderRef: ref,
  folderName: name,
  moment,
  media: items,
});
const viewOf = (fields: Partial<VaultView> = {}): VaultView => ({
  creatorId: CREATOR,
  folders: [
    folder('f1', 'Matin ☀️', 'day', [media('image'), media('image'), media('video')]),
    folder('f2', 'Soirée 🌙', 'night', [media('video'), media('image', true)]),
    folder('f3', 'En vrac', null),
  ],
  syncedAt: '2026-11-16T11:00:00.000Z',
  ...fields,
});

const GET = `/v1/creators/${CREATOR}/vault`;
const SYNC = `/v1/creators/${CREATOR}/vault/sync`;

/** A fake `/v1`: the vault as `reads` says it, one after the other (the last kept), every call counted. */
function serve(
  reads: (VaultView | number)[],
  sync: { status: number; body?: unknown } = { status: 200, body: { accounts: 1 } },
) {
  const calls: string[] = [];
  let read = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (method === 'POST' && url === SYNC)
        return Promise.resolve(new Response(JSON.stringify(sync.body ?? null), { status: sync.status }));
      if (url === GET) {
        const answer = reads[Math.min(read, reads.length - 1)];
        read += 1;
        return Promise.resolve(
          typeof answer === 'number'
            ? new Response(null, { status: answer })
            : new Response(JSON.stringify(answer), { status: 200 }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return calls;
}

function show(isOwner: boolean): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <VaultCard creatorId={CREATOR} creatorName="Lina" isOwner={isOwner} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('« Son coffre Reveal » (ADR 0099)', () => {
  it('shows her vault as last read: when, three figures, each folder in Reveal’s order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
    serve([viewOf()]);
    show(true);
    const card = await screen.findByRole('region', { name: 'Coffre Reveal de Lina' });
    expect(await within(card).findByText('Synchronisé il y a 1 h')).toBeDefined();
    const tiles = [...card.querySelectorAll('.nv-tile')].map((tile) => tile.textContent);
    expect(tiles).toEqual(['Médias5', 'Dossiers3', 'À classer1']);
    expect(within(card).getByText(/renomme-le dans Reveal/u)).toBeDefined();
    const names = [...card.querySelectorAll('.vx-folder__name')].map((name) => name.textContent);
    expect(names).toEqual(['Matin ☀️', 'Soirée 🌙', 'En vrac']);
    expect(within(card).getByText('2 photos · 1 vidéo')).toBeDefined();
    expect(within(card).getByText(/1 retiré de Reveal/u)).toBeDefined();
  });

  it('gives « Synchroniser le coffre » to the owner, and waits for the sync to go through', async () => {
    const after = viewOf({ syncedAt: '2026-11-16T12:00:05.000Z' });
    const calls = serve([viewOf(), viewOf(), after]);
    show(true);
    const button = await screen.findByRole('button', { name: 'Synchroniser le coffre' });
    fireEvent.click(button);
    expect(
      await screen.findByText('Impera relit son coffre dans Reveal : la carte se met à jour toute seule.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Synchro en cours' })).toHaveProperty('disabled', true);
    expect(calls.filter((call) => call === `POST ${SYNC}`)).toHaveLength(1);
    // The card reads her vault again on its own until its date moves.
    expect(await screen.findByText('Coffre à jour.', {}, { timeout: 8_000 })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Synchroniser le coffre' })).toHaveProperty('disabled', false);
  }, 10_000);

  it('says so when no account of hers can be read, and when the sync did not go', async () => {
    serve([viewOf()], { status: 200, body: { accounts: 0 } });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Synchroniser le coffre' }));
    expect(await screen.findByText(/Aucun compte Reveal lisible pour l’instant/u)).toBeDefined();
    cleanup();
    serve([viewOf()], { status: 503 });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Synchroniser le coffre' }));
    expect(await screen.findByText('La synchro n’a pas pu partir : réessaie dans un instant.')).toBeDefined();
  });

  it('shows the card to a manager, never the button', async () => {
    const calls = serve([viewOf()]);
    show(false);
    expect(await screen.findByText('Matin ☀️')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Synchroniser le coffre' })).toBeNull();
    expect(screen.getByText('Seul le propriétaire lance une synchro.')).toBeDefined();
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
  });

  it('says a vault never read, an empty one, and one that does not load', async () => {
    serve([viewOf({ folders: [], syncedAt: null })]);
    show(true);
    expect(await screen.findByText('Première synchro à lancer')).toBeDefined();
    expect(screen.getByText(/Lance une première synchro/u)).toBeDefined();
    expect(screen.getByText('Jamais synchronisé')).toBeDefined();
    cleanup();
    serve([viewOf({ folders: [] })]);
    show(true);
    expect(await screen.findByText('Coffre vide')).toBeDefined();
    cleanup();
    // One retry of its own (`retry: 1`), then the card says it.
    serve([500, 500, viewOf()]);
    show(true);
    expect(await screen.findByText('Son coffre ne se charge pas')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByText('Matin ☀️')).toBeDefined();
  });

  it('marks each folder à classer, and keeps it on screen before « Voir les N dossiers »', async () => {
    const many = Array.from({ length: 7 }, (_, at) =>
      folder(`f${String(at)}`, `Dossier ${String(at + 1)}`, at === 6 ? null : 'day'),
    );
    serve([viewOf({ folders: many })]);
    show(false);
    const last = (await screen.findByText('Dossier 7')).closest('li');
    if (last === null) throw new Error('no line');
    expect(within(last).getByRole('img', { name: 'À classer' })).toBeDefined();
    expect(screen.queryByText('Dossier 6')).toBeNull();
    expect(screen.getAllByRole('img', { name: 'À classer' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Voir les 7 dossiers' })).toBeDefined();
  });

  it('shows five folders, then all of them on demand', async () => {
    const many = Array.from({ length: 7 }, (_, at) =>
      folder(`f${String(at)}`, `Dossier ${String(at + 1)} ☀️`, 'day'),
    );
    serve([viewOf({ folders: many })]);
    show(false);
    await screen.findByText('Dossier 1 ☀️');
    expect(screen.queryByText('Dossier 6 ☀️')).toBeNull();
    const more = screen.getByRole('button', { name: 'Voir les 7 dossiers' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(screen.getByText('Dossier 7 ☀️')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Voir moins' }).getAttribute('aria-expanded')).toBe('true');
  });
});
