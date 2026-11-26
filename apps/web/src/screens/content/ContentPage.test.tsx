// @vitest-environment jsdom
import {
  ContentDropFileIdSchema,
  ContentDropIdSchema,
  ScriptStructureIdSchema,
  ScriptStructureVersionIdSchema,
} from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ContentPage } from './ContentPage';
import { dropOf, fileOf, fileWithHead, requestOf, scriptDropOf } from './fixtures';

const queueSend = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const retryNow = vi.hoisted(() => vi.fn());
const sendAgain = vi.hoisted(() => vi.fn());
const openScript = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => ({ map: new Map<string, unknown>(), held: new Set<string>() }));

vi.mock('./sends', () => ({
  useLiveSends: () => live.map,
  isSending: () => false,
  holds: (id: string) => live.held.has(id),
  queueSend,
  retryNow,
  sendAgain,
}));
vi.mock('@/scheduling/time', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/scheduling/time')>()),
  readerZone: () => 'Europe/Paris',
}));

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function serve(content: object, answers: Record<string, (body: unknown) => Response> = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      const answer = answers[`${method} ${url}`];
      if (answer !== undefined) return Promise.resolve(answer(body));
      if (url === '/v1/creator-space/content')
        return Promise.resolve(Response.json({ redone: [], ...content }));
      return Promise.resolve(new Response('null', { status: 404 }));
    }),
  );
  return calls;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ContentPage onOpenScript={openScript} />
    </QueryClientProvider>,
  );
}

const pick = (input: HTMLInputElement, files: File[]): void => {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
  queueSend.mockClear();
  retryNow.mockClear();
  sendAgain.mockClear();
  openScript.mockClear();
  live.map = new Map();
  live.held = new Set();
  // jsdom draws nothing: the page's scroll to a drop just sent, and its reduced-motion query, are stubbed.
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: true })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Contenu, the creator’s (CR-06 d)', () => {
  it('hides every empty section but « Envoyer autre chose », whose tiles are Reveal’s, without Script', async () => {
    serve({ requests: [], drops: [] });
    show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Envoyer autre chose' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'À tourner' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'En route' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Publié' })).toBeNull();
    const tiles = [...document.querySelectorAll('.ct-tile__name')].map((tile) => tile.textContent);
    // Reveal's four, the whale gifts and the videos to sell (ADR 0163), and the AI's two voices.
    expect(tiles).toHaveLength(8);
    expect(tiles.some((name) => name.includes('Script'))).toBe(false);
    expect(tiles.some((name) => name.includes('Insta'))).toBe(false);
  });

  it('lists her requests, the nearest first, a late one in amber', async () => {
    serve({
      requests: [
        requestOf({ dueOn: '2026-11-09', reason: 'Une vidéo pour dimanche' }),
        requestOf({ dueOn: '2026-11-03', reason: 'La séance promise' }),
      ],
      drops: [],
    });
    show();
    const section = (await screen.findByRole('heading', { name: 'À tourner' })).closest('section');
    if (section === null) throw new Error('no section');
    const reasons = [...section.querySelectorAll('.ct-card__why')].map((line) => line.textContent);
    expect(reasons).toEqual(['La séance promise', 'Une vidéo pour dimanche']);
    // Its date, not only its weekday (recette visuelle 16/11, CRE-13).
    const late = within(section).getByText('En retard depuis mar. 3 nov.');
    expect(late.className).toContain('ct-due--late');
    expect(within(section).getByText('Pour lundi').className).not.toContain('late');
    // The late one's « Déposer » is the screen's one neon; the other stays soft.
    const drops = within(section).getAllByRole('button', { name: 'Déposer' });
    expect(drops.map((button) => button.className.includes('nv-btn--neon'))).toEqual([true, false]);
    expect(document.querySelectorAll('.nv-btn--neon')).toHaveLength(1);
  });

  it('says « Pour aujourd’hui » in ink, and lights nothing while nothing is due', async () => {
    serve({ requests: [requestOf({ dueOn: '2026-11-09', reason: 'Une vidéo pour lundi' })], drops: [] });
    show();
    const section = (await screen.findByRole('heading', { name: 'À tourner' })).closest('section');
    if (section === null) throw new Error('no section');
    expect(within(section).getByRole('button', { name: 'Déposer' }).className).not.toContain('nv-btn--neon');
    cleanup();
    serve({ requests: [requestOf({ dueOn: '2026-11-05', reason: 'Une story pour ce soir' })], drops: [] });
    show();
    expect((await screen.findByText('Pour aujourd’hui')).className).toContain('ct-due--today');
  });

  it('shows her the team’s « À refaire » on her request, and a drop sent back without one (trou 7 du 21/11)', async () => {
    const request = requestOf({
      reason: 'La séance promise',
      redo: { sentence: 'Trop sombre, refais-la avec plus de lumière', at: '2026-11-05T09:00:00.000Z' },
    });
    serve({
      requests: [request],
      drops: [],
      redone: [
        {
          dropId: ContentDropIdSchema.parse('00000000-0000-4000-8000-0000000000dd'),
          category: 'reveal_story',
          redo: { sentence: 'C’est flou, refais-la plus nette', at: '2026-11-05T10:00:00.000Z' },
        },
      ],
    });
    show();
    const section = (await screen.findByRole('heading', { name: 'À tourner' })).closest('section');
    if (section === null) throw new Error('no section');
    const cards = within(section).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    const [story, seance] = cards;
    if (story === undefined || seance === undefined) throw new Error('no cards');
    expect(within(story).getByText('Story Reveal')).toBeDefined();
    expect(within(story).getByText('Ton dernier envoi est revenu')).toBeDefined();
    expect(within(story).getByText('C’est flou, refais-la plus nette')).toBeDefined();
    expect(within(seance).getByText('À refaire')).toBeDefined();
    expect(within(seance).getByText('Trop sombre, refais-la avec plus de lumière')).toBeDefined();
    fireEvent.click(within(story).getByRole('button', { name: 'Déposer à nouveau' }));
    expect(await screen.findByRole('dialog')).toBeDefined();
  });

  it('opens the sheet on the request Aujourd’hui sent her to drop, then forgets it (CRE-01)', async () => {
    const request = requestOf({ dueOn: '2026-11-04', reason: 'La séance promise' });
    serve({ requests: [request], drops: [] });
    const onAsked = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ContentPage onOpenScript={openScript} asked={request.id} onAsked={onAsked} />
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('dialog')).toBeDefined();
    expect(onAsked).toHaveBeenCalled();
  });

  it('begins a script asked with its version card by card, and opens it (SC-02 lot b2)', async () => {
    const request = requestOf({
      category: 'script',
      structureId: ScriptStructureIdSchema.parse('00000000-0000-4000-8000-0000000000aa'),
      structureVersionId: ScriptStructureVersionIdSchema.parse('00000000-0000-4000-8000-0000000000bb'),
    });
    const calls = serve(
      { requests: [request], drops: [] },
      {
        'POST /v1/creator-space/content/script-drops': (body) => {
          const sent = z.object({ id: z.string() }).parse(body);
          return Response.json(
            scriptDropOf({ id: ContentDropIdSchema.parse(sent.id), requestId: request.id }),
          );
        },
      },
    );
    show();
    expect(screen.queryByRole('button', { name: 'Déposer' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Commencer' }));
    await waitFor(() => {
      expect(openScript).toHaveBeenCalledTimes(1);
    });
    const start = calls.find((call) => call.method === 'POST');
    expect(start?.body).toMatchObject({ requestId: request.id });
    expect(openScript).toHaveBeenCalledWith(z.object({ id: z.string() }).parse(start?.body).id);
  });

  it('keeps a script she began in « À tourner », its name, day and progress, « Continuer » alone (CRE-12)', async () => {
    const request = requestOf({ category: 'script', dueOn: '2026-11-07', dropId: null });
    const script = scriptDropOf({ requestId: request.id, files: [fileOf({ slotKey: 'salon::0' })] });
    serve(
      { requests: [{ ...request, dropId: script.drop.id }], drops: [script.drop] },
      { [`GET /v1/creator-space/content/script-drops/${script.drop.id}`]: () => Response.json(script) },
    );
    show();
    const section = (await screen.findByRole('heading', { name: 'À tourner' })).closest('section');
    if (section === null) throw new Error('no section');
    expect(await within(section).findByText('Script · Soirée au salon')).toBeDefined();
    expect(within(section).getByText('Pour samedi')).toBeDefined();
    expect(within(section).getByText('1 / 4 médias')).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'En route' })).toBeNull();
    // « Retirer » lives in the script itself, away from « Continuer ».
    expect(within(section).queryByRole('button', { name: 'Retirer' })).toBeNull();
    fireEvent.click(within(section).getByRole('button', { name: 'Continuer' }));
    expect(openScript).toHaveBeenCalledWith(script.drop.id);
  });

  it('refuses before sending a file the category does not take, and says why', async () => {
    serve({ requests: [], drops: [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Vidéo short/u }));
    const dialog = screen.getByRole('dialog');
    const input = dialog.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    pick(input, [new File(['x'], 'photo.jpg', { type: 'image/jpeg' })]);
    expect(within(dialog).getByText(/prend seulement des vidéos/u)).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toHaveProperty('disabled', true);
    // Why it stays grey, beside it, even when the refused line is out of sight (CRE-16).
    expect(within(dialog).getByText('Retire le fichier refusé pour envoyer.')).toBeDefined();
  });

  it('says « Photo » or « Vidéo », never a file name, and marks a video’s thumbnail (CRE-16)', async () => {
    serve({ requests: [], drops: [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Séance boudoir/u }));
    const dialog = screen.getByRole('dialog');
    const input = dialog.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    pick(input, [
      new File(['a'], 'IMG_4032.HEIC', { type: '' }),
      new File(['bb'], 'IMG_4033.MOV', { type: 'video/quicktime' }),
    ]);
    const labels = [...dialog.querySelectorAll('.ct-chosen__name')].map((name) => name.textContent);
    expect(labels).toEqual(['Photo', 'Vidéo']);
    expect(dialog.querySelectorAll('.ct-thumb__play')).toHaveLength(1);
  });

  it('drops the files she chose, then sends each one in the background', async () => {
    const calls = serve(
      { requests: [], drops: [] },
      {
        // The server answers the drop under the ids her phone drew.
        'POST /v1/creator-space/drops': (body) => {
          const sent = z.object({ id: z.string(), files: z.array(z.object({ id: z.string() })) }).parse(body);
          return Response.json(
            dropOf({
              id: ContentDropIdSchema.parse(sent.id),
              state: 'uploading',
              files: sent.files.map((file) =>
                fileOf({
                  id: ContentDropFileIdSchema.parse(file.id),
                  kind: 'image',
                  mime: 'image/heic',
                  state: 'awaiting',
                }),
              ),
            }),
          );
        },
      },
    );
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Séance boudoir/u }));
    const dialog = screen.getByRole('dialog');
    const input = dialog.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    pick(input, [fileWithHead('IMG_0042.HEIC', 'heic')]);
    // « Envoyer » waits for its first bytes to be read (recette CRE-12).
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toHaveProperty('disabled', false);
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const drop = calls.find((call) => call.method === 'POST');
    expect(drop?.body).toMatchObject({ category: 'feed_shoot', files: [{ mime: 'image/heic', bytes: 12 }] });
    expect(queueSend).toHaveBeenCalledTimes(1);
  });

  it('shows each file on its way, one « Reprendre l’envoi » for a cut drop, and puts it above « Déposer »', async () => {
    const cutA = fileOf({ position: 1, kind: 'video', mime: 'video/quicktime', state: 'awaiting', bytes: 8 });
    const cutB = fileOf({ position: 2, kind: 'image', state: 'awaiting', bytes: 3 });
    const drop = dropOf({
      state: 'uploading',
      files: [fileOf({ position: 0, kind: 'video', mime: 'video/quicktime', state: 'received' }), cutA, cutB],
    });
    serve({ requests: [], drops: [drop] });
    show();
    const section = (await screen.findByRole('heading', { name: 'En route' })).closest('section');
    if (section === null) throw new Error('no section');
    expect(within(section).getByText('En préparation')).toBeDefined();
    expect(within(section).getAllByText('Envoi interrompu')).toHaveLength(2);
    expect(within(section).getByText('En envoi')).toBeDefined();
    // One button for the drop, never one per file, and the sentence that says what to do (CRE-10).
    expect(within(section).getAllByRole('button', { name: 'Reprendre l’envoi' })).toHaveLength(1);
    expect(within(section).getByText(/Rechoisis les mêmes fichiers dans ta galerie/u)).toBeDefined();
    const input = section.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    pick(input, [
      fileWithHead('IMG_1.JPG', 'jpeg'),
      fileWithHead('IMG_2.MOV', 'mov'),
      new File(['x'], 'autre.jpg'),
    ]);
    await waitFor(() => {
      expect(queueSend).toHaveBeenCalledTimes(2);
    });
    expect(within(section).getByText(/Un fichier choisi n’est pas de ce dépôt/u)).toBeDefined();
    // Still to go up: « En route » comes before « Déposer » (CRE-09).
    const titles = [...document.querySelectorAll('h2')].map((title) => title.textContent);
    expect(titles.indexOf('En route')).toBeLessThan(titles.indexOf('Envoyer autre chose'));
  });

  it('tells a server that refuses from a cut network, with « Réessayer » (CRE-10)', async () => {
    const stalled = fileOf({ position: 0, state: 'awaiting' });
    const held = fileOf({ position: 1, state: 'awaiting' });
    live.map = new Map<string, unknown>([[stalled.id, { sent: 0, total: 4, rate: null, phase: 'stalled' }]]);
    serve({ requests: [], drops: [dropOf({ state: 'uploading', files: [stalled] })] });
    show();
    expect(await screen.findByText('L’envoi n’aboutit pas pour l’instant')).toBeDefined();
    expect(screen.queryByText(/Réseau coupé/u)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(retryNow).toHaveBeenCalledWith(stalled.id);
    expect(screen.getByRole('status').textContent).toContain('garde l’appli ouverte');
    cleanup();
    // Cut while the page was open: the phone still holds it, it goes again without the gallery.
    live.map = new Map<string, unknown>([[held.id, { sent: 0, total: 4, rate: null, phase: 'failed' }]]);
    live.held = new Set([held.id]);
    serve({ requests: [], drops: [dropOf({ state: 'uploading', files: [held] })] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(sendAgain).toHaveBeenCalledWith([held.id], expect.any(Function));
  });

  it('refuses before sending a file that is not what its name says, and does not send it (recette CRE-12)', async () => {
    const calls = serve({ requests: [], drops: [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Séance boudoir/u }));
    const dialog = screen.getByRole('dialog');
    const input = dialog.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    pick(input, [
      fileWithHead('IMG_0042.HEIC', 'heic'),
      new File(['juste du texte'], 'faux.jpg', { type: 'image/jpeg' }),
    ]);
    expect(
      await within(dialog).findByText('Ce fichier n’est pas ce qu’il annonce : renvoie-le depuis ta galerie'),
    ).toBeDefined();
    expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toHaveProperty('disabled', true);
    // Only the renamed one is blamed; taken out, the real photo goes.
    expect(within(dialog).getAllByText(/n’est pas ce qu’il annonce/u)).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: /Enlever Photo 2/u }));
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toHaveProperty('disabled', false);
    });
    expect(calls.some((call) => call.method === 'POST')).toBe(false);
  });

  it('never resumes a cut send with a file of the same size that is not what was declared (recette CRE-12)', async () => {
    const cut = fileOf({ position: 0, kind: 'image', mime: 'image/jpeg', state: 'awaiting', bytes: 14 });
    serve({ requests: [], drops: [dropOf({ state: 'uploading', files: [cut] })] });
    show();
    const section = (await screen.findByRole('heading', { name: 'En route' })).closest('section');
    const input = section?.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    pick(input, [new File(['juste du texte'], 'faux.jpg')]);
    expect(
      await screen.findByText('Ce fichier n’est pas ce qu’il annonce : renvoie-le depuis ta galerie'),
    ).toBeDefined();
    expect(queueSend).not.toHaveBeenCalled();
  });

  it('keeps a request in « À tourner » while its drop goes up, without a second drop (recette CRE-12)', async () => {
    const drop = dropOf({ state: 'uploading', files: [fileOf({ state: 'awaiting' })] });
    serve({ requests: [requestOf({ reason: 'La séance promise', dropId: drop.id })], drops: [drop] });
    show();
    const section = (await screen.findByRole('heading', { name: 'À tourner' })).closest('section');
    if (section === null) throw new Error('no section');
    expect(within(section).getByText('La séance promise')).toBeDefined();
    expect(
      within(section).getByText('Ton dépôt est en route. S’il s’arrête, reprends-le dans « En route ».'),
    ).toBeDefined();
    expect(within(section).queryByRole('button', { name: 'Déposer' })).toBeNull();
    expect(within(section).queryByRole('button', { name: 'Je ne peux pas' })).toBeNull();
  });

  it('takes a request out of « À tourner » once its drop is received', async () => {
    const drop = dropOf({ state: 'received', files: [fileOf({ state: 'received' })] });
    serve({ requests: [requestOf({ reason: 'La séance promise', dropId: drop.id })], drops: [drop] });
    show();
    expect(await screen.findByRole('heading', { name: 'En route' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'À tourner' })).toBeNull();
  });

  it('keeps the files in the order she sets: numbered, moved up or down, sent in that order', async () => {
    const calls = serve({ requests: [], drops: [] });
    show();
    fireEvent.click(await screen.findByRole('button', { name: /Séance boudoir/u }));
    const dialog = screen.getByRole('dialog');
    const input = dialog.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    const first = fileWithHead('IMG_1.HEIC', 'heic');
    pick(input, [first, fileWithHead('IMG_2.HEIC', 'heic', 1), fileWithHead('IMG_3.HEIC', 'heic', 2)]);
    // The same file picked again goes once.
    pick(input, [first]);
    // Her file names are kept for a computer's screen only (CSS), in the order she sets.
    const names = (): (string | null)[] =>
      [...dialog.querySelectorAll('.ct-chosen__file')].map((name) => name.textContent);
    expect(names()).toEqual([' · IMG_1.HEIC', ' · IMG_2.HEIC', ' · IMG_3.HEIC']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Monter Photo 3' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Monter Photo 2' }));
    expect(names()).toEqual([' · IMG_3.HEIC', ' · IMG_1.HEIC', ' · IMG_2.HEIC']);
    expect(within(dialog).getByRole('button', { name: 'Monter Photo 1' })).toHaveProperty('disabled', true);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Envoyer' })).toHaveProperty('disabled', false);
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer' }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true);
    });
    const drop = calls.find((call) => call.method === 'POST');
    expect(drop?.body).toMatchObject({ files: [{ bytes: 14 }, { bytes: 12 }, { bytes: 13 }] });
  });

  it('replaces a medium the team asked again where it is, and says what does not fit (trou 7 du 21/11)', async () => {
    const asked = fileOf({
      position: 0,
      redo: { sentence: 'Trop sombre, refais-la', at: '2026-11-05T09:00:00.000Z' },
    });
    const refused = fileOf({ position: 1, state: 'refused', refusal: 'Photo illisible' });
    const drop = dropOf({ state: 'ready', files: [asked, refused] });
    const calls = serve(
      { requests: [], drops: [drop] },
      {
        [`POST /v1/creator-space/drops/${drop.id}/files/${asked.id}/replace`]: (body) => {
          const sent = z.object({ id: ContentDropFileIdSchema }).parse(body);
          return Response.json({
            ...drop,
            state: 'received',
            files: [fileOf({ id: sent.id, position: 0, state: 'awaiting' }), refused],
          });
        },
      },
    );
    show();
    const section = (await screen.findByRole('heading', { name: 'En route' })).closest('section');
    if (section === null) throw new Error('no section');
    const card = within(section).getByText('Trop sombre, refais-la').closest('.ct-card');
    if (!(card instanceof HTMLElement)) throw new Error('no card');
    expect(within(card).getByText('Photo illisible')).toBeDefined();
    expect(within(card).getByRole('button', { name: 'Remplacer Photo 2' })).toBeDefined();
    fireEvent.click(within(card).getByRole('button', { name: 'Remplacer Photo 1' }));
    const input = card.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
    expect(input.accept).toContain('image/*');
    pick(input, [new File([new Uint8Array(4)], 'vocal.mp3', { type: 'audio/mpeg' })]);
    expect(await within(card).findByRole('alert')).toHaveProperty(
      'textContent',
      '« Feed · Séance boudoir » prend seulement des photos et des vidéos',
    );
    fireEvent.click(within(card).getByRole('button', { name: 'Remplacer Photo 1' }));
    const better = fileWithHead('nouvelle.jpg', 'jpeg', 10, 'image/jpeg');
    pick(input, [better]);
    await waitFor(() => {
      expect(queueSend).toHaveBeenCalledTimes(1);
    });
    const posted = calls.filter((call) => call.method === 'POST');
    expect(posted).toHaveLength(1);
    expect(posted[0]?.body).toMatchObject({ mime: 'image/jpeg', bytes: 13 });
    expect(queueSend).toHaveBeenCalledWith(
      drop.id,
      z.object({ id: z.string() }).parse(posted[0]?.body).id,
      better,
      expect.any(Function),
    );
  });

  it('keeps a published drop out of « En route » when nothing of it is asked again', async () => {
    serve({ requests: [], drops: [dropOf({ state: 'ready', exportedAt: '2026-11-04T09:00:00.000Z' })] });
    show();
    expect(await screen.findByRole('heading', { name: 'Publié' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'En route' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remplacer/u })).toBeNull();
  });
});
