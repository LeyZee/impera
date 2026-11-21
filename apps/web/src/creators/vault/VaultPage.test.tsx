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
/** Every folder of `viewOf()` ticked whole: all of it in Impera. */
const whole = (refs: (string | null)[] = ['f1', 'f2', 'f3']): VaultChoicesView =>
  choicesOf({
    folders: refs.map((folderRef) => ({ platformAccountId: ACCOUNT, folderRef, imported: true })),
  });
const mediaChoice = (
  platformMediaId: string,
  imported: boolean,
  description: VaultChoicesView['media'][number]['description'] = 'none',
  excerpt: string | null = null,
) => ({ platformAccountId: ACCOUNT, platformMediaId, imported, description, excerpt });

describe('« Son coffre » (ADR 0099, ADR 0145 § 5 and its avenant du 20/11)', () => {
  it('shows only what is in Impera: the folders imported, what is described, the line of figures', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-16T12:00:00.000Z'));
    const view = viewOf();
    const f2 = view.folders[1];
    if (f2 === undefined) throw new Error('no folder');
    const f2Media = [media('video', false, { platformMediaId: 'in-f2' }), media('image')];
    serve(
      [viewOf({ folders: [view.folders[0] ?? f2, { ...f2, media: f2Media }, ...view.folders.slice(2)] })],
      undefined,
      {
        choices: [
          choicesOf({
            folders: [{ platformAccountId: ACCOUNT, folderRef: 'f1', imported: true }],
            media: [mediaChoice('in-f2', true, 'described', 'Inventée')],
          }),
        ],
      },
    );
    show(true);
    const card = await screen.findByRole('region', { name: 'Coffre Reveal de Lina' });
    expect(await within(card).findByText('Reveal · Synchronisé il y a 1 h')).toBeDefined();
    const rail = await within(card).findByRole('navigation', { name: 'Ses dossiers dans Impera' });
    const names = [...rail.querySelectorAll('.vp-folder__label')].map((name) => name.textContent);
    // « En vrac » has nothing in Impera: it waits in « Choisir dans Reveal ».
    expect(names).toEqual(['Matin ☀️', 'Soirée 🌙']);
    expect(within(rail).getByText('3 médias · aucun décrit')).toBeDefined();
    expect(within(rail).getByText('1 média · 1 décrit')).toBeDefined();
    expect(within(card).getByText('4 médias dans Impera · 1 décrit')).toBeDefined();
    // No tick on the rail: what enters Impera is chosen in the window.
    expect(within(rail).queryByRole('checkbox')).toBeNull();
    expect(within(card).getByRole('button', { name: 'Choisir dans Reveal' })).toBeDefined();
  });

  it('says nothing is in Impera yet with one way in, and gives the manager the same words without it', async () => {
    serve([viewOf()]);
    show(true);
    expect(await screen.findByText('Rien dans Impera pour l’instant')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Choisir dans Reveal' })).toBeDefined();
    // Nothing of Reveal listed on the screen itself, and one way into the window.
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Choisir dans Reveal' })).toHaveLength(1);
    cleanup();
    const calls = serve([viewOf()]);
    show(false);
    expect(await screen.findByText(/Le propriétaire choisit dans le coffre Reveal de Lina/u)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Choisir dans Reveal' })).toBeNull();
    expect(
      screen.getByText('Seul le propriétaire choisit ce qui entre dans Impera et fait décrire.'),
    ).toBeDefined();
    expect(calls.some((call) => call.method !== 'GET')).toBe(false);
  });

  it('opens « Choisir dans Reveal », reads Reveal again and says it while it reads', async () => {
    const after = viewOf({ syncedAt: '2026-11-16T12:00:05.000Z' });
    const calls = serve([viewOf(), viewOf(), after], undefined, { choices: [whole(['f1'])] });
    show(true);
    // Her choices read, the vault shows its rail and the head's button (not the empty start's).
    await screen.findByRole('navigation', { name: 'Ses dossiers dans Impera' });
    fireEvent.click(screen.getByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    expect(said(calls, 'POST', SYNC)).toHaveLength(1);
    expect(within(dialog).getByText('Lecture de son coffre Reveal…')).toBeDefined();
    const cards = within(dialog).getByRole('list', { name: 'Ses dossiers dans Reveal' });
    expect(
      within(cards)
        .getAllByRole('checkbox')
        .map((each) => each.getAttribute('aria-checked')),
    ).toEqual(['true', 'false', 'false']);
    expect(within(cards).getByText('Dans Impera')).toBeDefined();
    expect(await within(dialog).findByText(/^Synchronisé/u, {}, { timeout: 8_000 })).toBeDefined();
  }, 10_000);

  it('says in the window when no account of hers can be read', async () => {
    serve([viewOf()], { status: 200, body: { accounts: 0 } });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    expect(await within(dialog).findByText(/Aucun compte Reveal lisible pour l’instant/u)).toBeDefined();
  });

  it('pills each folder’s Day or Night in the window, « À classer » when its name says neither (PRO1-04)', async () => {
    serve([viewOf()], { status: 200, body: { accounts: 0 } });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    expect([...dialog.querySelectorAll('.vx-moment')].map((tag) => tag.textContent)).toEqual([
      '☀️ Jour',
      '🌙 Nuit',
      'À classer',
    ]);
  });

  it('says a vault never read as such, never « Coffre vide » (PRO1-09)', async () => {
    serve([viewOf({ folders: [], syncedAt: null })], { status: 200, body: { accounts: 0 } });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    expect(await within(dialog).findByText('Pas encore lu')).toBeDefined();
    expect(within(dialog).queryByText('Coffre vide')).toBeNull();
  });

  it('ticks folders as cards, writes nothing before « Importer », then imports only what was ticked', async () => {
    const calls = serve([named()], undefined, {
      put: () => whole(['f1']),
    });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    const card = within(dialog).getByRole('checkbox', { name: /^Matin ☀️/u });
    fireEvent.click(card);
    expect(card.getAttribute('aria-checked')).toBe('true');
    expect(said(calls, 'PUT', CHOICES)).toHaveLength(0);
    expect(within(dialog).getByText('1 dossier coché')).toBeDefined();
    expect(within(dialog).getByText('À importer')).toBeDefined();
    // Ticked again: back as it was, nothing waits.
    fireEvent.click(card);
    expect(within(dialog).queryByText('1 dossier coché')).toBeNull();
    fireEvent.click(card);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importer 3 médias' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(said(calls, 'PUT', CHOICES)).toEqual([
      { platformAccountId: ACCOUNT, folders: [{ folderRef: 'f1', imported: true }], media: [] },
    ]);
    expect(
      await screen.findByText(
        '3 médias importés. Pour les faire décrire, ouvre un dossier et sélectionne-les.',
      ),
    ).toBeDefined();
    expect(await screen.findByRole('list', { name: 'Médias de Matin ☀️' })).toBeDefined();
  });

  it('opens a folder in the window to tick its media one by one, the root last as « Hors dossier »', async () => {
    const calls = serve([named()], undefined, { put: () => choicesOf({ media: [mediaChoice('p2', true)] }) });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    const names = [...dialog.querySelectorAll('.vk-card__name')].map((name) => name.textContent);
    expect(names).toEqual(['Matin ☀️', 'Hors dossier']);
    fireEvent.click(within(dialog).getByRole('button', { name: /Voir les médias/u }));
    expect(within(dialog).getByText('0 sur 3 cochés')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '2. Photo' }));
    expect(within(dialog).getByText('1 sur 3 cochés')).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tous les dossiers' }));
    expect(
      within(dialog)
        .getByRole('checkbox', { name: /^Matin ☀️/u })
        .getAttribute('aria-checked'),
    ).toBe('mixed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importer 1 média' }));
    await waitFor(() => {
      expect(said(calls, 'PUT', CHOICES)).toHaveLength(1);
    });
    // A folder in part: its whole tick off, then its media one by one.
    expect(said(calls, 'PUT', CHOICES)[0]).toEqual({
      platformAccountId: ACCOUNT,
      folders: [{ folderRef: 'f1', imported: false }],
      media: [{ platformMediaId: 'p2', imported: true }],
    });
  });

  it('says in the window when the choice was not saved, keeps it open and reads the server again (CODE-01)', async () => {
    const calls = serve([named()], { status: 200, body: { accounts: 0 } }, { put: () => 503 });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /^Matin ☀️/u }));
    const before = said(calls, 'GET', CHOICES).length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importer 3 médias' }));
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      'Le choix n’a pas été enregistré : le serveur ne répond pas. Réessaie dans un instant.',
    );
    // Part of it may have gone through: what the screen shows is read again from the server.
    await waitFor(() => {
      expect(said(calls, 'GET', CHOICES).length).toBeGreaterThan(before);
    });
  });

  it('says what of a folder stayed in Reveal, and opens the window on it', async () => {
    serve([named()], undefined, { choices: [choicesOf({ media: [mediaChoice('p1', true)] })] });
    show(true);
    expect(await screen.findByText('2 autres médias de ce dossier sont restés dans Reveal')).toBeDefined();
    const grid = screen.getByRole('list', { name: 'Médias de Matin ☀️' });
    expect(
      within(grid)
        .getAllByRole('button')
        .map((tile) => tile.getAttribute('aria-label')),
    ).toEqual(['1. Photo']);
    fireEvent.click(screen.getByRole('button', { name: /Les choisir/u }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    expect(within(dialog).getByRole('heading', { name: 'Matin ☀️' })).toBeDefined();
    expect(within(dialog).getByText('1 sur 3 cochés')).toBeDefined();
  });

  it('selects media one by one, by a run with Shift, or all; takes them out of Impera after saying what it keeps', async () => {
    const calls = serve([named()], undefined, {
      choices: [whole(['f1'])],
      put: () => choicesOf(),
    });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '1. Photo' }));
    expect(screen.getByRole('toolbar').textContent).toContain('1 média sélectionné');
    fireEvent.click(screen.getByRole('button', { name: '3. Vidéo · 0:12' }), { shiftKey: true });
    expect(screen.getByText('3 médias sélectionnés')).toBeDefined();
    // A media Reveal removed is never picked.
    fireEvent.click(screen.getByRole('button', { name: '4. Photo, retiré de Reveal' }));
    expect(screen.getByText('3 médias sélectionnés')).toBeDefined();
    // In Impera: the cost of describing them is on the button, 2 × 0.5 c€ + 1.5 c€ said 3 c€.
    expect(screen.getByRole('button', { name: /Décrire 3 par IA ≈ 0,03\s€/u })).toHaveProperty(
      'disabled',
      false,
    );
    expect(screen.queryByRole('button', { name: /^Importer/u })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer d’Impera' }));
    const dialog = await screen.findByRole('dialog', { name: 'Retirer 3 médias d’Impera' });
    expect(within(dialog).getByText('Rien ne bouge dans Reveal.')).toBeDefined();
    expect(within(dialog).getByText(/Leurs descriptions sont gardées/u)).toBeDefined();
    expect(said(calls, 'PUT', CHOICES)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retirer' }));
    await waitFor(() => {
      expect(said(calls, 'PUT', CHOICES)).toHaveLength(1);
    });
    expect(said(calls, 'PUT', CHOICES)[0]).toMatchObject({
      media: ['p1', 'p2', 'v1'].map((platformMediaId) => ({ platformMediaId, imported: false })),
    });
  });

  it('selects all and none, and leaves the selection by Échap', async () => {
    serve([named()], undefined, { choices: [whole(['f1'])] });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner dans ce dossier' }));
    expect(screen.getByText('3 médias sélectionnés')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Tout désélectionner' }));
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Tout sélectionner dans ce dossier' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Sélectionner' })).toBeDefined();
    expect(screen.queryByRole('toolbar')).toBeNull();
  });

  it('says why nothing is to pay when the selection is described already', async () => {
    serve([named()], undefined, {
      choices: [choicesOf({ media: [mediaChoice('p1', true, 'described', 'Inventée')] })],
    });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Sélectionner' }));
    fireEvent.click(screen.getByRole('button', { name: '1. Photo, décrit' }));
    expect(screen.getByRole('button', { name: 'Décrire par IA' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Déjà décrits ou en cours de description : rien à payer.')).toBeDefined();
  });

  it('describes by AI only after the count and the cost were shown, under one key, then says how far it went', async () => {
    const described = mediaChoice('p2', true, 'described', 'Une photo inventée');
    const imported = choicesOf({
      media: [mediaChoice('p1', true), described, mediaChoice('v1', true, 'asked')],
    });
    const estimate: VaultDescribeAnswer = {
      status: 'estimate',
      count: 1,
      photos: 1,
      videos: 0,
      alreadyDescribed: 1,
      alreadyAsked: 1,
      notImported: 0,
      notDescribable: 0,
      costCents: 1,
      capLeftCents: 1_674,
    };
    const calls = serve([named()], undefined, {
      choices: [
        imported,
        choicesOf({ media: [mediaChoice('p1', true, 'asked'), described, mediaChoice('v1', true, 'asked')] }),
      ],
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
    expect((await screen.findAllByText('Description en cours')).length).toBeGreaterThan(0);
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
    fireEvent.click(await screen.findByRole('button', { name: '1. Photo' }));
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
    fireEvent.click(await screen.findByRole('button', { name: '1. Photo' }));
    fireEvent.click(screen.getByRole('button', { name: /^Décrire \d+ par IA/u }));
    expect(await screen.findByText(/Le coût n’a pas pu être calculé : rien n’est lancé/u)).toBeDefined();
  });

  it('filters by kind and the media not described; a media left to the agency says it in amber', async () => {
    serve([named()], undefined, {
      choices: [
        choicesOf({
          folders: [{ platformAccountId: ACCOUNT, folderRef: 'f1', imported: true }],
          media: [mediaChoice('p1', true, 'described', 'Inventée'), mediaChoice('p2', true, 'to_agency')],
        }),
      ],
    });
    show(true);
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    expect(await within(grid).findByText('Illisible par l’IA : à décrire par l’agence')).toBeDefined();
    const labels = () =>
      [...document.querySelectorAll('.vp-grid .vp-tile')].map((tile) => tile.getAttribute('aria-label'));
    // The one Reveal removed has its own group, titled.
    expect(screen.getByRole('heading', { name: 'Retirés de Reveal 1' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Vidéos' }));
    expect(labels()).toEqual(['1. Vidéo · 0:12']);
    fireEvent.click(screen.getByRole('button', { name: 'Photos' }));
    expect(labels()).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Non décrits' }));
    expect(labels()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Non importés' })).toBeNull();
  });

  it('opens the sheet of a media: what it is, its description, Reveal’s text and range', async () => {
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
    expect(screen.getAllByText('1 média · 1 décrit').length).toBeGreaterThan(0);
    const tile = await screen.findByRole('button', { name: '1. Vidéo · 1:15, décrit' });
    expect(tile.querySelector('img')).toBeNull();
    fireEvent.click(tile);
    const sheet = screen.getByRole('dialog', { name: 'Vidéo · 1:15' });
    expect(within(sheet).getByText('Ajouté le 10 novembre 2026')).toBeDefined();
    expect(within(sheet).getByText('Une vidéo inventée')).toBeDefined();
    expect(within(sheet).getByText('Texte inventé du coffre')).toBeDefined();
    expect(within(sheet).getByText('10 € – 25 €')).toBeDefined();
    // The note says the picture was read only once it was; a picture that fails says so (PRO1-10).
    expect(within(sheet).queryByText(/Image lue dans Reveal/u)).toBeNull();
    const sharp = sheet.querySelector('.vx-sharp');
    if (sharp === null) throw new Error('sharp');
    fireEvent.error(sharp);
    expect(
      within(sheet).getByText('Aperçu indisponible : sa session Reveal n’est pas lisible.'),
    ).toBeDefined();
    expect(within(sheet).queryByText(/Image lue dans Reveal/u)).toBeNull();
    fireEvent.keyDown(sheet, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('goes from one media to the next in the sheet, by its arrows and the keyboard’s', async () => {
    const one = media('image', false, { platformMediaId: 'one' });
    const two = media('audio', false, { platformMediaId: 'two', durationSeconds: 9 });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [one, two])] })], undefined, {
      choices: [whole(['f1'])],
    });
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: '1. Photo' }));
    expect(
      within(screen.getByRole('dialog'))
        .getByRole('button', { name: 'Média précédent' })
        .hasAttribute('disabled'),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Média suivant' }));
    const voice = screen.getByRole('dialog', { name: 'Vocal · 0:09' });
    expect(voice.querySelector('img')).toBeNull();
    expect(voice.querySelectorAll('.vx-voice__wave rect').length).toBe(28);
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByRole('dialog', { name: 'Photo' })).toBeDefined();
  });

  it('follows the address when the page passes it: the folder named opens, « Dossiers » goes back', async () => {
    serve([viewOf()], undefined, { choices: [whole()] });
    const asked: (string | null)[] = [];
    show(true, { folderId: 'f2', onFolder: (id) => asked.push(id) });
    expect(await screen.findByRole('list', { name: 'Médias de Soirée 🌙' })).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Dossiers' }));
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'Ses dossiers dans Impera' })).getByRole('button', {
        name: /Matin ☀️/u,
      }),
    );
    expect(asked).toEqual([null, 'f1']);
    cleanup();
    serve([viewOf()], undefined, { choices: [whole()] });
    // A folder the last sync no longer lists, or one not in Impera: the first one, never an error.
    show(true, { folderId: 'gone', onFolder: () => undefined });
    expect(await screen.findByRole('list', { name: 'Médias de Matin ☀️' })).toBeDefined();
  });

  it('shows the sharp pictures by the menu’s « Flou des médias », on the pointer, in the sheet, and falls back to the blur (ADR 0138)', async () => {
    const photo = media('image', false, { platformMediaId: 'photo_1' });
    const video = media('video', false, { platformMediaId: 'video_1' });
    const gone = media('image', true, { platformMediaId: 'gone_1' });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [photo, video, gone])] })], undefined, {
      choices: [whole(['f1'])],
    });
    show(true);
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    const sharp = () => [...grid.querySelectorAll('img.vx-sharp')].map((img) => img.getAttribute('src'));
    expect(sharp()).toEqual([]);
    const tile = screen.getByRole('button', { name: '1. Photo' });
    fireEvent.pointerEnter(tile);
    expect(sharp()).toEqual([`/v1/creators/${CREATOR}/vault/media/photo_1/preview`]);
    fireEvent.pointerLeave(tile);
    expect(sharp()).toEqual([]);
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

  it('keeps the menu’s « Nets » while selecting (recette 20/11); blurred, the eye of one tile shows it sharp', async () => {
    const photo = media('image', false, { platformMediaId: 'photo_1' });
    serve([viewOf({ folders: [folder('f1', 'Matin ☀️', 'day', [photo])] })], undefined, {
      choices: [whole(['f1'])],
    });
    setMediaBlur(false);
    show(true);
    const grid = await screen.findByRole('list', { name: 'Médias de Matin ☀️' });
    const sharp = () => grid.querySelectorAll('img.vx-sharp').length;
    expect(sharp()).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sélectionner' }));
    expect(sharp()).toBe(1);
    // Sharp already: no eye to show it sharp.
    expect(screen.queryByRole('button', { name: 'Voir net le média 1' })).toBeNull();
    act(() => {
      setMediaBlur(true);
    });
    expect(sharp()).toBe(0);
    fireEvent.pointerEnter(screen.getByRole('button', { name: '1. Photo' }));
    expect(sharp()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Voir net le média 1' }));
    expect(sharp()).toBe(1);
    // The eye does not tick the media.
    expect(screen.queryByRole('toolbar')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flouter le média 1' }));
    expect(sharp()).toBe(0);
  });

  it('follows « Flou des médias » in the window’s mosaics too', async () => {
    serve([named()]);
    setMediaBlur(false);
    show(true);
    fireEvent.click(await screen.findByRole('button', { name: 'Choisir dans Reveal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Choisir dans Reveal' });
    expect(dialog.querySelectorAll('.vk-card img.vx-sharp').length).toBe(3);
    act(() => {
      setMediaBlur(true);
    });
    expect(dialog.querySelectorAll('.vk-card img.vx-sharp').length).toBe(0);
  });
});
