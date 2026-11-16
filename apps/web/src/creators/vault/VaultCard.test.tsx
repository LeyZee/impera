// @vitest-environment jsdom
import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  type VaultMediaView,
  type VaultView,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VaultCard } from './VaultCard';

/* An invented creator and vault (ADR 0010): no real creator, no real media. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const media = (
  kind: 'image' | 'video',
  removed = false,
  fields: Partial<VaultMediaView> = {},
): VaultMediaView => ({
  platformMediaId: `m-${kind}-${String(Math.random())}`,
  kind,
  durationSeconds: kind === 'video' ? 12 : null,
  uploadedAt: '2026-11-10T10:00:00.000Z',
  platformDescription: null,
  suggestedPriceMinor: null,
  // Invented one-colour hash (rgb 200, 40, 90): never a real preview.
  blurhash: '00M_Ai',
  removed,
  ...fields,
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

function show(
  isOwner: boolean,
  address?: { folderId: string | null; onFolder: (id: string | null) => void },
): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <VaultCard creatorId={CREATOR} creatorName="Lina" isOwner={isOwner} {...address} />
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
    const names = [...card.querySelectorAll('.vx-folder__label')].map((name) => name.textContent);
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

  it('marks each folder à classer, on its tile and once opened', async () => {
    serve([viewOf()]);
    show(false);
    const tile = await screen.findByRole('button', { name: 'Ouvrir En vrac' });
    expect(within(tile).getByRole('img', { name: 'À classer' })).toBeDefined();
    expect(screen.getAllByRole('img', { name: 'À classer' })).toHaveLength(1);
    fireEvent.click(tile);
    const title = await screen.findByRole('heading', { name: /En vrac/u });
    expect(within(title).getByRole('img', { name: 'À classer' })).toBeDefined();
  });

  it('opens a folder: « Coffre / son nom », its media in Reveal’s order, each a blurred preview', async () => {
    serve([viewOf()]);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir Matin ☀️' }));
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    const tiles = within(grid).getAllByRole('button');
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      '1. Photo',
      '2. Photo',
      '3. Vidéo · 0:12',
    ]);
    // The platform's blurhash drawn here, never a link to the file.
    const previews = [...grid.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
    expect(previews).toHaveLength(3);
    expect(previews.every((src) => src.startsWith('data:image/bmp;base64,'))).toBe(true);
    expect(screen.getByRole('navigation', { name: 'Chemin dans le coffre' }).textContent).toContain(
      'Matin ☀️',
    );
    // Back to the folders.
    fireEvent.click(screen.getByRole('button', { name: 'Coffre' }));
    expect(await screen.findByRole('button', { name: 'Ouvrir Soirée 🌙' })).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Médias de Matin ☀️' })).toBeNull();
  });

  it('opens the sheet of a media: what it is, when it came, Reveal’s text and range; Échap closes it', async () => {
    const described = media('video', false, {
      durationSeconds: 75,
      platformDescription: 'Texte inventé du coffre',
      suggestedPriceMinor: { min: 1_000, max: 2_500 },
      blurhash: null,
    });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [described, media('image', true)])] })]);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir Matin ☀️' }));
    const tile = await screen.findByRole('button', { name: '1. Vidéo · 1:15' });
    // No preview from Reveal: the kind's own colour, no picture.
    expect(tile.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: '2. Photo, retiré de Reveal' })).toBeDefined();
    fireEvent.click(tile);
    expect(tile.getAttribute('aria-pressed')).toBe('true');
    const sheet = screen.getByRole('complementary', { name: 'Fiche du média' });
    expect(within(sheet).getByText('Vidéo · 1:15')).toBeDefined();
    expect(within(sheet).getByText('Ajouté le 10 novembre 2026')).toBeDefined();
    expect(within(sheet).getByText('Texte inventé du coffre')).toBeDefined();
    expect(within(sheet).getByText('10 € – 25 €')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Fiche du média' })).toBeNull();
    fireEvent.click(tile);
    fireEvent.click(screen.getByRole('button', { name: 'Fermer la fiche' }));
    expect(screen.queryByRole('complementary', { name: 'Fiche du média' })).toBeNull();
  });

  it('follows the address when the page passes it: the folder named opens, one gone shows the folders', async () => {
    serve([viewOf()]);
    const asked: (string | null)[] = [];
    show(true, { folderId: 'f2', onFolder: (id) => asked.push(id) });
    expect(await screen.findByRole('list', { name: 'Médias de Soirée 🌙' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Coffre' }));
    expect(asked).toEqual([null]);
    cleanup();
    serve([viewOf()]);
    const opened: (string | null)[] = [];
    show(true, { folderId: 'gone', onFolder: (id) => opened.push(id) });
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir Matin ☀️' }));
    expect(opened).toEqual(['f1']);
    // The page owns the address: nothing opens until it says so.
    expect(screen.queryByRole('list', { name: 'Médias de Matin ☀️' })).toBeNull();
  });

  it('shows the sharp pictures on « Voir net », on the pointer, in the sheet, and falls back to the blur (ADR 0138)', async () => {
    const photo = media('image', false, { platformMediaId: 'photo_1' });
    const video = media('video', false, { platformMediaId: 'video_1' });
    const gone = media('image', true, { platformMediaId: 'gone_1' });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [photo, video, gone])] })]);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir Matin ☀️' }));
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    const sharp = () => [...grid.querySelectorAll('img.vx-sharp')].map((img) => img.getAttribute('src'));
    // Blurred first: nothing asked of Reveal until a gesture.
    expect(sharp()).toEqual([]);
    const tile = screen.getByRole('button', { name: '1. Photo' });
    fireEvent.pointerEnter(tile);
    expect(sharp()).toEqual([`/v1/creators/${CREATOR}/vault/media/photo_1/preview`]);
    fireEvent.pointerLeave(tile);
    expect(sharp()).toEqual([]);
    const toggle = screen.getByRole('button', { name: 'Voir net' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    // The photo and the video's poster; never a media Reveal removed.
    expect(sharp()).toEqual([
      `/v1/creators/${CREATOR}/vault/media/photo_1/preview`,
      `/v1/creators/${CREATOR}/vault/media/video_1/preview`,
    ]);
    const first = grid.querySelector('img.vx-sharp');
    if (first === null) throw new Error('no picture');
    expect(first.getAttribute('data-state')).toBe('loading');
    fireEvent.load(first);
    expect(first.getAttribute('data-state')).toBe('shown');
    // A picture that does not come: the blur stays, nothing else said.
    const second = grid.querySelectorAll('img.vx-sharp')[1];
    if (second === undefined) throw new Error('no second picture');
    fireEvent.error(second);
    expect(sharp()).toEqual([`/v1/creators/${CREATOR}/vault/media/photo_1/preview`]);
    fireEvent.click(screen.getByRole('button', { name: 'Flouter' }));
    expect(sharp()).toEqual([]);
    // The sheet always shows it sharp.
    fireEvent.click(tile);
    const sheet = screen.getByRole('complementary', { name: 'Fiche du média' });
    expect(sheet.querySelector('img.vx-sharp')?.getAttribute('src')).toBe(
      `/v1/creators/${CREATOR}/vault/media/photo_1/preview`,
    );
  });

  it('offers no « Voir net » in a folder of voice notes only', async () => {
    const voice = { ...media('image'), kind: 'audio' as const, durationSeconds: 8, blurhash: null };
    serve([viewOf({ folders: [folder('f1', 'Vocaux ☀️', 'day', [voice])] })]);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Ouvrir Vocaux ☀️' }));
    expect(await screen.findByRole('button', { name: '1. Vocal · 0:08' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Voir net' })).toBeNull();
  });
});
