// @vitest-environment jsdom
import {
  CreatorIdSchema,
  PlatformAccountIdSchema,
  type VaultChoicesView,
  type VaultDescribeAnswer,
  type VaultMediaView,
  type VaultView,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { VaultPage } from './VaultPage';

import { setMediaBlur } from '@/shell/media-blur';

/* An invented creator and vault (ADR 0010): no real creator, no real media. */
const CREATOR = CreatorIdSchema.parse('0192f3a0-0000-7000-8000-0000000000c1');
const ACCOUNT = PlatformAccountIdSchema.parse('0192f3a0-0000-7000-8000-0000000000a1');
const media = (
  kind: VaultMediaView['kind'],
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
const CHOICES = `/v1/creators/${CREATOR}/vault/choices`;
const DESCRIBE = `/v1/creators/${CREATOR}/vault/describe`;

const choicesOf = (fields: Partial<VaultChoicesView> = {}): VaultChoicesView => ({
  creatorId: CREATOR,
  folders: [],
  media: [],
  ...fields,
});

/** A call the fake `/v1` received: its method, its address, its body read back. */
interface Call {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
}

/**
 * A fake `/v1`: the vault as `reads` says it, one after the other (the last kept); the choices as `api.choices`, a PUT
 * answered by `api.put`, a describe by `api.describe` (in turn, the last kept). Every call kept.
 */
function serve(
  reads: (VaultView | number)[],
  sync: { status: number; body?: unknown } = { status: 200, body: { accounts: 1 } },
  api: {
    choices?: VaultChoicesView[];
    put?: (body: unknown) => VaultChoicesView | number;
    describe?: (VaultDescribeAnswer | number)[];
  } = {},
): Call[] {
  const calls: Call[] = [];
  let read = 0;
  let chosen = 0;
  let described = 0;
  const json = (body: unknown, status = 200) =>
    Promise.resolve(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ method, url, body });
      if (method === 'POST' && url === SYNC) return json(sync.body ?? null, sync.status);
      if (method === 'GET' && url === CHOICES) {
        const all = api.choices ?? [choicesOf()];
        const answer = all[Math.min(chosen, all.length - 1)];
        chosen += 1;
        return json(answer);
      }
      if (method === 'PUT' && url === CHOICES) {
        const answer = api.put?.(body) ?? 500;
        return typeof answer === 'number' ? json(null, answer) : json(answer);
      }
      if (method === 'POST' && url === DESCRIBE) {
        const all = api.describe ?? [500];
        const answer = all[Math.min(described, all.length - 1)];
        described += 1;
        return typeof answer === 'number' ? json(null, answer) : json(answer);
      }
      if (url === GET) {
        const answer = reads[Math.min(read, reads.length - 1)];
        read += 1;
        return typeof answer === 'number'
          ? Promise.resolve(new Response(null, { status: answer }))
          : json(answer);
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return calls;
}
const said = (calls: Call[], method: string, url: string): unknown[] =>
  calls.filter((call) => call.method === method && call.url === url).map((call) => call.body);

function show(
  isOwner: boolean,
  address?: { folderId: string | null; onFolder: (id: string | null) => void },
): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <VaultPage creatorId={CREATOR} creatorName="Lina" isOwner={isOwner} {...address} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  setMediaBlur(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A folder of named media, for the tests that tick and describe. */
const named = () => {
  const p1 = media('image', false, { platformMediaId: 'p1' });
  const p2 = media('image', false, { platformMediaId: 'p2' });
  const v1 = media('video', false, { platformMediaId: 'v1' });
  const gone = media('image', true, { platformMediaId: 'gone' });
  return viewOf({
    folders: [folder('f1', 'Matin ☀️', 'day', [p1, p2, v1, gone]), folder(null, null, null, [])],
  });
};
const mediaChoice = (
  platformMediaId: string,
  imported: boolean,
  description: VaultChoicesView['media'][number]['description'] = 'none',
  excerpt: string | null = null,
) => ({ platformAccountId: ACCOUNT, platformMediaId, imported, description, excerpt });

describe('« Son coffre Reveal » (ADR 0099, ADR 0145 § 5)', () => {
  it('shows her vault as last read: when, what is imported and described, the folders with the root last', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
    serve([viewOf({ folders: [folder(null, null, null), ...viewOf().folders] })]);
    show(true);
    const card = await screen.findByRole('region', { name: 'Coffre Reveal de Lina' });
    expect(await within(card).findByText('Synchronisé il y a 1 h')).toBeDefined();
    // Nothing imported: one sentence says it, no line of figures, no empty gauge, never a plate per figure.
    expect(await within(card).findByText(/Rien n’est encore importé/u)).toBeDefined();
    expect(within(card).queryByText('Aucun média importé sur 6')).toBeNull();
    expect(card.querySelectorAll('.vp-sum__meter, .nv-tile')).toHaveLength(0);
    const rail = within(card).getByRole('navigation', { name: 'Ses dossiers' });
    const names = [...rail.querySelectorAll('.vp-folder__label')].map((name) => name.textContent);
    // The root, first in Reveal's list, is an ordinary folder at the bottom: never « Tout ».
    expect(names).toEqual(['Matin ☀️', 'Soirée 🌙', 'En vrac', 'Racine du coffre']);
    expect(within(rail).getByText('Aucun importé sur 3')).toBeDefined();
    // A folder named with neither ☀️ nor 🌙 says why on its row, readable without opening it.
    expect(within(rail).getAllByText('Ni ☀️ ni 🌙 : à renommer dans Reveal')).toHaveLength(1);
    // Nothing ticked at first, the root included.
    const ticks = within(rail).getAllByRole('checkbox');
    expect(ticks).toHaveLength(4);
    expect(ticks.every((tick) => tick instanceof HTMLInputElement && !tick.checked)).toBe(true);
  });

  it('gives « Synchroniser » to the owner, and waits for the sync to go through', async () => {
    const after = viewOf({ syncedAt: '2026-11-16T12:00:05.000Z' });
    const calls = serve([viewOf(), viewOf(), after]);
    show(true);
    const button = await screen.findByRole('button', { name: 'Synchroniser' });
    fireEvent.click(button);
    expect(
      await screen.findByText('Impera relit son coffre dans Reveal : la carte se met à jour toute seule.'),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: 'Synchro en cours' })).toHaveProperty('disabled', true);
    expect(said(calls, 'POST', SYNC)).toHaveLength(1);
    expect(await screen.findByText('Coffre à jour.', {}, { timeout: 8_000 })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Synchroniser' })).toHaveProperty('disabled', false);
  }, 10_000);

  it('says so when no account of hers can be read, and when the sync did not go', async () => {
    serve([viewOf()], { status: 200, body: { accounts: 0 } });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Synchroniser' }));
    expect(await screen.findByText(/Aucun compte Reveal lisible pour l’instant/u)).toBeDefined();
    cleanup();
    serve([viewOf()], { status: 503 });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Synchroniser' }));
    expect(await screen.findByText('La synchro n’a pas pu partir : réessaie dans un instant.')).toBeDefined();
  });

  it('shows the vault to a manager: no sync, no tick, no selection', async () => {
    const calls = serve([viewOf()]);
    show(false);
    expect(await screen.findByRole('list', { name: 'Médias de Matin ☀️' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Synchroniser' })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sélectionner' })).toBeNull();
    expect(screen.getByText('Seul le propriétaire synchronise, importe et fait décrire.')).toBeDefined();
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('says a vault never read, an empty one, and one that does not load', async () => {
    serve([viewOf({ folders: [], syncedAt: null })]);
    show(true);
    expect(await screen.findByText('Première synchro à lancer')).toBeDefined();
    expect(screen.getByText(/Rien n’entre dans Impera avant que tu le coches/u)).toBeDefined();
    expect(screen.getByText('Jamais synchronisé')).toBeDefined();
    cleanup();
    serve([viewOf({ folders: [] })]);
    show(true);
    expect(await screen.findByText('Coffre vide')).toBeDefined();
    cleanup();
    serve([500, 500, viewOf()]);
    show(true);
    expect(await screen.findByText('Son coffre ne se charge pas')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(await screen.findByRole('list', { name: 'Médias de Matin ☀️' })).toBeDefined();
  });

  it('marks a folder à classer, in the rail and once open', async () => {
    serve([viewOf()]);
    show(false, { folderId: 'f3', onFolder: () => undefined });
    const rail = await screen.findByRole('navigation', { name: 'Ses dossiers' });
    const row = within(rail).getByRole('button', { name: /En vrac/u });
    expect(within(row).getByRole('img', { name: 'À classer' })).toBeDefined();
    const title = await screen.findByRole('heading', { name: /En vrac/u });
    expect(within(title).getByRole('img', { name: 'À classer' })).toBeDefined();
  });

  it('opens the first folder, its media in Reveal’s order, each a blurred preview; a folder of the rail opens', async () => {
    serve([viewOf()]);
    show(true);
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    const tiles = within(grid).getAllByRole('button');
    expect(tiles.map((tile) => tile.getAttribute('aria-label'))).toEqual([
      '1. Photo, non importé',
      '2. Photo, non importé',
      '3. Vidéo · 0:12, non importé',
    ]);
    const previews = [...grid.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '');
    expect(previews).toHaveLength(3);
    expect(previews.every((src) => src.startsWith('data:image/bmp;base64,'))).toBe(true);
    const rail = screen.getByRole('navigation', { name: 'Ses dossiers' });
    expect(
      within(rail)
        .getByRole('button', { name: /Matin ☀️/u })
        .getAttribute('aria-current'),
    ).toBe('true');
    fireEvent.click(within(rail).getByRole('button', { name: /Soirée 🌙/u }));
    expect(await screen.findByRole('list', { name: 'Médias de Soirée 🌙' })).toBeDefined();
    expect(screen.queryByRole('list', { name: 'Médias de Matin ☀️' })).toBeNull();
  });

  it('ticks a folder whole, says a folder imported in part with a dash, and unticks it', async () => {
    const view = named();
    const calls = serve([view], undefined, {
      choices: [choicesOf({ media: [mediaChoice('p1', true)] })],
      put: () =>
        choicesOf({
          folders: [{ platformAccountId: ACCOUNT, folderRef: 'f1', imported: true }],
          media: ['p1', 'p2', 'v1'].map((id) => mediaChoice(id, true)),
        }),
    });
    show(true);
    const tick = await screen.findByRole('checkbox', { name: 'Importer tout Matin ☀️' });
    await waitFor(() => {
      expect(tick).toHaveProperty('indeterminate', true);
    });
    expect(tick.getAttribute('aria-checked')).toBe('mixed');
    // Said once, on the rail; the grid says it by its groups.
    expect(screen.getAllByText(/1 sur 3 importé$/u)).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Importés 1' })).toBeDefined();
    expect(screen.getByRole('heading', { name: 'Dans Reveal seulement 2' })).toBeDefined();
    fireEvent.click(tick);
    await waitFor(() => {
      expect(tick).toHaveProperty('checked', true);
    });
    expect(said(calls, 'PUT', CHOICES)).toEqual([
      { platformAccountId: ACCOUNT, folders: [{ folderRef: 'f1', imported: true }], media: [] },
    ]);
    expect(tick).toHaveProperty('indeterminate', false);
    expect(screen.getAllByText(/Les 3 importés$/u)).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: /Dans Reveal seulement/u })).toBeNull();
    expect(screen.getByRole('button', { name: '1. Photo, importé' })).toBeDefined();
  });

  it('says when a tick was not saved', async () => {
    serve([named()], undefined, { put: () => 503 });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    fireEvent.click(screen.getByRole('button', { name: '1. Photo, non importé' }));
    fireEvent.click(screen.getByRole('button', { name: /Importer/u }));
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Le choix n’a pas été enregistré : le serveur ne répond pas. Réessaie dans un instant.',
    );
  });

  it('selects media one by one, by a run with Shift, or all; imports and takes them out from the bar', async () => {
    const calls = serve([named()], undefined, {
      put: () =>
        choicesOf({ media: [mediaChoice('p1', true), mediaChoice('p2', true), mediaChoice('v1', true)] }),
    });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1. Photo, non importé' }));
    expect(screen.getByRole('toolbar').textContent).toContain('1 média sélectionné');
    fireEvent.click(screen.getByRole('button', { name: '3. Vidéo · 0:12, non importé' }), { shiftKey: true });
    expect(screen.getByText('3 médias sélectionnés')).toBeDefined();
    // A media Reveal removed is never picked.
    fireEvent.click(screen.getByRole('button', { name: '4. Photo, non importé, retiré de Reveal' }));
    expect(screen.getByText('3 médias sélectionnés')).toBeDefined();
    // Not imported yet: nothing to describe, so nothing to pay.
    expect(screen.getByRole('button', { name: /Décrire par IA/u })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Importer 3' }));
    // Nothing imported among them: nothing to take out.
    await waitFor(() => {
      expect(said(calls, 'PUT', CHOICES)).toHaveLength(1);
    });
    expect(said(calls, 'PUT', CHOICES)[0]).toEqual({
      platformAccountId: ACCOUNT,
      folders: [],
      media: ['p1', 'p2', 'v1'].map((platformMediaId) => ({ platformMediaId, imported: true })),
    });
    // Imported, still selected: the cost of describing them is on the button, 2 × 0.5 c€ + 1.5 c€ said 3 c€.
    const describeButton = await screen.findByRole('button', { name: /Décrire \d+ par IA ≈ 0,03\s€/u });
    expect(describeButton).toHaveProperty('disabled', false);
    // All imported now: « Importer » leaves, « Retirer » carries the bar.
    expect(screen.queryByRole('button', { name: /^Importer/u })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer 3 d’Impera' }));
    await waitFor(() => {
      expect(said(calls, 'PUT', CHOICES)).toHaveLength(2);
    });
    expect(said(calls, 'PUT', CHOICES)[1]).toMatchObject({
      media: ['p1', 'p2', 'v1'].map((platformMediaId) => ({ platformMediaId, imported: false })),
    });
    // « Tout sélectionner dans ce dossier », then again to undo; Échap leaves the selection.
    fireEvent.click(screen.getByRole('button', { name: 'Tout désélectionner' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner dans ce dossier' }));
    expect(screen.getByText('3 médias sélectionnés')).toBeDefined();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Sélectionner' })).toBeDefined();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('describes by AI only after the count and the cost were shown, under one key, then says how far it went', async () => {
    const described = mediaChoice('p2', true, 'described', 'Une photo inventée');
    const imported = choicesOf({ media: [mediaChoice('p1', true), described] });
    const estimate: VaultDescribeAnswer = {
      status: 'estimate',
      count: 1,
      photos: 1,
      videos: 0,
      alreadyDescribed: 1,
      alreadyAsked: 0,
      notImported: 1,
      notDescribable: 0,
      costCents: 1,
      capLeftCents: 1_674,
    };
    const calls = serve([named()], undefined, {
      choices: [imported, choicesOf({ media: [mediaChoice('p1', true, 'asked'), described] })],
      describe: [estimate, { status: 'asked', count: 1 }],
    });
    show(true);
    // Described: its excerpt under it, in the AI's colour.
    expect(await screen.findByText('Une photo inventée')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner dans ce dossier' }));
    fireEvent.click(screen.getByRole('button', { name: /Décrire 1 par IA ≈ 0,01\s€/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Décrire par IA' });
    expect(await within(dialog).findByText('≈ 0,01 €')).toBeDefined();
    expect(within(dialog).getByText('Reste du plafond du jour : 16,74 €')).toBeDefined();
    expect(within(dialog).getByText('1 déjà décrit, pas recompté')).toBeDefined();
    expect(within(dialog).getByText('1 non importé : importe-le d’abord')).toBeDefined();
    const [first] = said(calls, 'POST', DESCRIBE);
    expect(first).toMatchObject({ platformMediaIds: ['p1', 'p2', 'v1'], confirm: null });
    fireEvent.click(within(dialog).getByRole('button', { name: /Décrire 1 · ≈ 0,01\s€/u }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const [, second] = said(calls, 'POST', DESCRIBE);
    expect(second).toMatchObject({ confirm: { count: 1, costCents: 1 } });
    // One key for the gesture: the count and the run under the same one.
    const key =
      typeof first === 'object' && first !== null && 'idempotencyKey' in first ? first.idempotencyKey : null;
    expect(key).toEqual(expect.any(String));
    expect(second).toHaveProperty('idempotencyKey', key);
    expect(await screen.findByText('Descriptions : 0 sur 1')).toBeDefined();
    expect(await screen.findByText('Description en cours')).toBeDefined();
  });

  it('asks nothing when the count moved, shows the new one, and stops a run over the day’s cap', async () => {
    const base = {
      status: 'estimate' as const,
      photos: 1,
      videos: 0,
      alreadyDescribed: 0,
      alreadyAsked: 0,
      notImported: 0,
      notDescribable: 0,
    };
    serve([named()], undefined, {
      choices: [choicesOf({ media: [mediaChoice('p1', true)] })],
      describe: [
        { ...base, count: 1, costCents: 1, capLeftCents: 500 },
        { ...base, count: 1, costCents: 1, capLeftCents: 0 },
      ],
    });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    fireEvent.click(await screen.findByRole('button', { name: '1. Photo, importé' }));
    fireEvent.click(screen.getByRole('button', { name: /^Décrire \d+ par IA/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Décrire par IA' });
    fireEvent.click(await within(dialog).findByRole('button', { name: /Décrire 1/u }));
    expect(
      await within(dialog).findByText('Le compte a changé depuis : vérifie avant de confirmer.'),
    ).toBeDefined();
    expect(within(dialog).getByText(/dépasse ce qui reste du plafond IA du jour/u)).toBeDefined();
    expect(within(dialog).getByRole('button', { name: /Décrire 1/u })).toHaveProperty('disabled', true);
  });

  it('says a count that failed, nothing started', async () => {
    serve([named()], undefined, {
      choices: [choicesOf({ media: [mediaChoice('p1', true)] })],
      describe: [503],
    });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    fireEvent.click(await screen.findByRole('button', { name: '1. Photo, importé' }));
    fireEvent.click(screen.getByRole('button', { name: /^Décrire \d+ par IA/u }));
    expect(await screen.findByText(/Le coût n’a pas pu être calculé : rien n’est lancé/u)).toBeDefined();
  });

  it('filters by kind, the media not described and those not imported; a media left to the agency says it in amber', async () => {
    serve([named()], undefined, {
      choices: [
        choicesOf({
          media: [mediaChoice('p1', true, 'described', 'Inventée'), mediaChoice('p2', true, 'to_agency')],
        }),
      ],
    });
    show(true);
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    expect(await within(grid).findByText('Illisible par l’IA : à décrire par l’agence')).toBeDefined();
    const labels = () =>
      within(grid)
        .getAllByRole('button')
        .map((tile) => tile.getAttribute('aria-label'));
    fireEvent.click(screen.getByRole('button', { name: 'Vidéos' }));
    expect(labels()).toEqual(['3. Vidéo · 0:12, non importé'.replace('3.', '1.')]);
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
    expect(labels()).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Non décrits' }));
    expect(labels()).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: 'Non importés' }));
    expect(labels()).toEqual(['1. Vidéo · 0:12, non importé', '2. Photo, non importé, retiré de Reveal']);
    fireEvent.click(screen.getByRole('button', { name: 'Vidéos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
    fireEvent.click(screen.getByRole('button', { name: 'Non importés' }));
    fireEvent.click(screen.getByRole('button', { name: 'Non décrits' }));
    expect(labels()).toHaveLength(4);
  });

  it('opens the sheet of a media: what it is, imported or not, its description, Reveal’s text and range', async () => {
    const one = media('video', false, {
      platformMediaId: 'one',
      durationSeconds: 75,
      platformDescription: 'Texte inventé du coffre',
      suggestedPriceMinor: { min: 1_000, max: 2_500 },
      blurhash: null,
    });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [one, media('image', true)])] })], undefined, {
      choices: [choicesOf({ media: [mediaChoice('one', true, 'described', 'Une vidéo inventée')] })],
    });
    show(true);
    expect(await screen.findByRole('heading', { name: 'Matin ☀️' })).toBeDefined();
    // What the folder holds; how much is imported is said on the rail and by the grid's groups.
    expect(await screen.findByText('1 vidéo · 1 retiré de Reveal')).toBeDefined();
    const tile = await screen.findByRole('button', { name: '1. Vidéo · 1:15, importé, décrit' });
    expect(tile.querySelector('img')).toBeNull();
    fireEvent.click(tile);
    const sheet = screen.getByRole('dialog', { name: 'Vidéo · 1:15' });
    expect(within(sheet).getByText('Ajouté le 10 novembre 2026')).toBeDefined();
    expect(within(sheet).getByText('Importé')).toBeDefined();
    expect(within(sheet).getByText('Une vidéo inventée')).toBeDefined();
    expect(within(sheet).getByText('Texte inventé du coffre')).toBeDefined();
    expect(within(sheet).getByText('10 € – 25 €')).toBeDefined();
    expect(within(sheet).getByText('1 sur 2')).toBeDefined();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes from one media to the next in the sheet, by its arrows and the keyboard’s', async () => {
    const one = media('image', false, { platformMediaId: 'one' });
    const two = media('audio', false, { platformMediaId: 'two', durationSeconds: 9 });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [one, two])] })]);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: '1. Photo, non importé' }));
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('button', { name: 'Média précédent' })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Média suivant' }));
    const voice = screen.getByRole('dialog', { name: 'Vocal · 0:09' });
    expect(voice.querySelector('img')).toBeNull();
    expect(voice.querySelectorAll('.vx-voice__wave rect').length).toBe(28);
    expect(within(voice).queryByText(/jamais gardée par Impera/u)).toBeNull();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'Photo' })).toBeDefined();
  });

  it('follows the address when the page passes it: the folder named opens, « Dossiers » goes back', async () => {
    serve([viewOf()]);
    const asked: (string | null)[] = [];
    show(true, { folderId: 'f2', onFolder: (id) => asked.push(id) });
    expect(await screen.findByRole('list', { name: 'Médias de Soirée 🌙' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Dossiers' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Ses dossiers' })).getByRole('button', {
        name: /Matin ☀️/u,
      }),
    );
    expect(asked).toEqual([null, 'f1']);
    cleanup();
    serve([viewOf()]);
    // A folder the last sync no longer lists: the first one, never an error.
    show(true, { folderId: 'gone', onFolder: () => undefined });
    expect(await screen.findByRole('list', { name: 'Médias de Matin ☀️' })).toBeDefined();
  });

  it('shows the sharp pictures by the rail’s « Flou des médias », on the pointer, in the sheet, and falls back to the blur (ADR 0138)', async () => {
    const photo = media('image', false, { platformMediaId: 'photo_1' });
    const video = media('video', false, { platformMediaId: 'video_1' });
    const gone = media('image', true, { platformMediaId: 'gone_1' });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [photo, video, gone])] })]);
    show(true);
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    const sharp = () => [...grid.querySelectorAll('img.vx-sharp')].map((img) => img.getAttribute('src'));
    expect(sharp()).toEqual([]);
    const tile = screen.getByRole('button', { name: '1. Photo, non importé' });
    fireEvent.pointerEnter(tile);
    expect(sharp()).toEqual([`/v1/creators/${CREATOR}/vault/media/photo_1/preview`]);
    fireEvent.pointerLeave(tile);
    expect(sharp()).toEqual([]);
    // A folder has no « Voir net » of its own: the rail's « Flou des médias » sets it for every screen.
    expect(screen.queryByRole('button', { name: 'Voir net' })).toBeNull();
    act(() => {
      setMediaBlur(false);
    });
    expect(sharp()).toEqual([
      `/v1/creators/${CREATOR}/vault/media/photo_1/preview`,
      `/v1/creators/${CREATOR}/vault/media/video_1/preview`,
    ]);
    const first = grid.querySelector('img.vx-sharp');
    if (first === null) throw new Error('no picture');
    expect(first.getAttribute('data-state')).toBe('loading');
    fireEvent.load(first);
    expect(first.getAttribute('data-state')).toBe('shown');
    const second = grid.querySelectorAll('img.vx-sharp')[1];
    if (second === undefined) throw new Error('no second picture');
    fireEvent.error(second);
    expect(sharp()).toEqual([`/v1/creators/${CREATOR}/vault/media/photo_1/preview`]);
    act(() => {
      setMediaBlur(true);
    });
    expect(sharp()).toEqual([]);
    fireEvent.click(tile);
    const sheet = screen.getByRole('dialog', { name: 'Photo' });
    expect(sheet.querySelector('img.vx-sharp')?.getAttribute('src')).toBe(
      `/v1/creators/${CREATOR}/vault/media/photo_1/preview`,
    );
  });

  it('while selecting, the pointer leaves the blur and the eye of one tile shows it sharp', async () => {
    const photo = media('image', false, { platformMediaId: 'photo_1' });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [photo])] })]);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    const grid = screen.getByRole('list', { name: 'Médias de Matin ☀️' });
    const sharp = () => grid.querySelectorAll('img.vx-sharp').length;
    fireEvent.pointerEnter(screen.getByRole('button', { name: '1. Photo, non importé' }));
    expect(sharp()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Voir net le média 1' }));
    expect(sharp()).toBe(1);
    // The eye does not tick the media.
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flouter le média 1' }));
    expect(sharp()).toBe(0);
  });
});
