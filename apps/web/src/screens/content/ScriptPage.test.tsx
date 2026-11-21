// @vitest-environment jsdom
import { ContentDropFileIdSchema, ContentDropIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ScriptPage } from './ScriptPage';
import { fileOf, fileWithHead, scriptDropOf } from './fixtures';

const queueSend = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const sendAgain = vi.hoisted(() => vi.fn());
const back = vi.hoisted(() => vi.fn());
const live = vi.hoisted(() => ({ map: new Map<string, unknown>(), held: new Set<string>() }));

vi.mock('./sends', () => ({
  useLiveSends: () => live.map,
  isSending: () => false,
  holds: (id: string) => live.held.has(id),
  queueSend,
  retryNow: vi.fn(),
  sendAgain,
}));

const DROP_ID = ContentDropIdSchema.parse('00000000-0000-4000-8000-00000000d201');
const BASE = `/v1/creator-space/content/script-drops/${DROP_ID}`;

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}

function serve(script: unknown, answers: Record<string, (body: unknown) => Response> = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      const answer = answers[`${method} ${url}`];
      if (answer !== undefined) return Promise.resolve(answer(body));
      if (method === 'GET' && url === BASE) return Promise.resolve(Response.json(script));
      return Promise.resolve(new Response('null', { status: 404 }));
    }),
  );
  return calls;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ScriptPage dropId={DROP_ID} onBack={back} />
    </QueryClientProvider>,
  );
}

const pick = (input: Element | null, files: File[]): void => {
  if (!(input instanceof HTMLInputElement)) throw new Error('no picker');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

beforeEach(() => {
  queueSend.mockClear();
  sendAgain.mockClear();
  back.mockClear();
  live.map = new Map();
  live.held = new Set();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('her script, card by card (SC-02 lot b2)', () => {
  it('opens on the first card, its image drawn from her frozen version, its slots under it', async () => {
    serve(scriptDropOf({ id: DROP_ID }));
    show();
    expect(await screen.findByRole('heading', { level: 1, name: 'Soirée au salon' })).toBeDefined();
    expect(screen.getByText('Carton 1 sur 4')).toBeDefined();
    expect(screen.getByText('0 / 4 médias')).toBeDefined();
    // Its number in her script, never the agency's code (CRE-14).
    expect(screen.queryByText('E1')).toBeNull();
    expect(screen.getByRole('img', { name: 'Carton 1 : Salon' }).getAttribute('src')).toBe(
      `${BASE}/cards/salon`,
    );
    expect(screen.getByText('De face, le regard vers toi')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Choisir une photo' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Choisir une vidéo' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Précédent' })).toBeNull();
  });

  it('refuses a file of another kind before anything goes up', async () => {
    const calls = serve(scriptDropOf({ id: DROP_ID }));
    show();
    await screen.findByText('Carton 1 sur 4');
    const photo = screen.getByRole('button', { name: 'Choisir une photo' }).parentElement;
    pick(photo?.querySelector('input[type="file"]') ?? null, [
      new File(['x'], 'v.mp4', { type: 'video/mp4' }),
    ]);
    expect(await screen.findByText('Cet emplacement attend une photo')).toBeDefined();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
  });

  it('fills a slot with the file she chose, then sends it in the background', async () => {
    const calls = serve(scriptDropOf({ id: DROP_ID }), {
      [`PUT ${BASE}/slots/salon%3A%3A0`]: (body) => {
        const sent = z.object({ id: z.string() }).parse(body);
        return Response.json(
          scriptDropOf({
            id: DROP_ID,
            files: [
              fileOf({ id: ContentDropFileIdSchema.parse(sent.id), slotKey: 'salon::0', state: 'awaiting' }),
            ],
          }).drop,
        );
      },
    });
    show();
    await screen.findByText('Carton 1 sur 4');
    const photo = screen.getByRole('button', { name: 'Choisir une photo' }).parentElement;
    pick(photo?.querySelector('input[type="file"]') ?? null, [
      fileWithHead('a.jpg', 'jpeg', 0, 'image/jpeg'),
    ]);
    await waitFor(() => {
      expect(queueSend).toHaveBeenCalledTimes(1);
    });
    expect(calls.find((call) => call.method === 'PUT')?.body).toMatchObject({ mime: 'image/jpeg', bytes: 3 });
    // No send runs in this test: the file reads as cut, is not counted (CRE-10), and the same button takes it again.
    expect(await screen.findByText('Envoi interrompu')).toBeDefined();
    expect(screen.getByText('0 / 4 médias')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeDefined();
    expect(screen.getByText(/rechoisis le même fichier dans ta galerie/u)).toBeDefined();
  });

  it('refuses a file that is not what its name says before anything goes up (recette CRE-12)', async () => {
    const calls = serve(scriptDropOf({ id: DROP_ID }));
    show();
    await screen.findByText('Carton 1 sur 4');
    const photo = screen.getByRole('button', { name: 'Choisir une photo' }).parentElement;
    pick(photo?.querySelector('input[type="file"]') ?? null, [
      new File(['juste du texte'], 'faux.jpg', { type: 'image/jpeg' }),
    ]);
    expect(
      await screen.findByText('Ce fichier n’est pas ce qu’il annonce : renvoie-le depuis ta galerie'),
    ).toBeDefined();
    expect(calls.some((call) => call.method === 'PUT')).toBe(false);
    expect(queueSend).not.toHaveBeenCalled();
  });

  it('sends a cut media again without the gallery while the phone still holds it (CRE-10)', async () => {
    const cut = fileOf({ slotKey: 'salon::0', state: 'awaiting' });
    live.held = new Set([cut.id]);
    serve(scriptDropOf({ id: DROP_ID, files: [cut] }));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Réessayer' }));
    expect(sendAgain).toHaveBeenCalledWith([cut.id], expect.any(Function));
  });

  it('withdraws the script from inside it, asked once more (CRE-12)', async () => {
    const calls = serve(scriptDropOf({ id: DROP_ID }), {
      [`DELETE /v1/creator-space/drops/${DROP_ID}`]: () => new Response(null, { status: 204 }),
    });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Retirer ce script' }));
    expect(screen.getByText(/Les médias déjà ajoutés partent avec lui/u)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }));
    await waitFor(() => {
      expect(back).toHaveBeenCalledTimes(1);
    });
    expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
  });

  it('comes back to the preview when every slot is filled, and sends the script', async () => {
    const full = scriptDropOf({
      id: DROP_ID,
      files: ['salon::0', 'pont::0', 'chambre:A:0', 'chambre:B:0'].map((slotKey) => fileOf({ slotKey })),
    });
    const calls = serve(full, {
      [`POST ${BASE}/submit`]: () => Response.json({ ...full.drop, state: 'uploading' }),
    });
    show();
    expect(await screen.findByRole('heading', { name: 'Aperçu de ton script' })).toBeDefined();
    // A quiet check per complete card, no amber pill (CRE-14).
    expect(screen.getAllByRole('img', { name: 'Complet' })).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le script' }));
    await waitFor(() => {
      expect(back).toHaveBeenCalledTimes(1);
    });
    expect(calls.some((call) => call.method === 'POST' && call.url === `${BASE}/submit`)).toBe(true);
  });

  it('shows what is missing first, and leads to it instead of « Envoyer le script »', async () => {
    serve(
      scriptDropOf({
        id: DROP_ID,
        files: ['salon::0', 'pont::0', 'chambre:A:0'].map((slotKey) => fileOf({ slotKey })),
      }),
    );
    show();
    expect(await screen.findByText('Carton 4 sur 4')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Voir l’aperçu' }));
    expect(screen.getByText(/Il manque encore 1 média\./u)).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Envoyer le script' })).toBeNull();
    const list = document.querySelector('.sk-preview__list');
    if (!(list instanceof HTMLElement)) throw new Error('no preview');
    const rows = [...list.querySelectorAll('button')];
    // The missing card first, by its number and its whole title.
    expect(rows[0]?.querySelector('.sk-row__name')?.textContent).toBe('4Chambre · Série B');
    expect(rows[0]?.textContent).toContain('0 / 1 média');
    fireEvent.click(screen.getByRole('button', { name: 'Compléter le carton 4' }));
    expect(screen.getByText('Série B · Plein jour')).toBeDefined();
  });
});
