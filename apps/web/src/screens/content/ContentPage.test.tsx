// @vitest-environment jsdom
import { ContentDropFileIdSchema, ContentDropIdSchema } from '@impera/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { ContentPage } from './ContentPage';
import { dropOf, fileOf, requestOf } from './fixtures';

const queueSend = vi.hoisted(() => vi.fn(() => Promise.resolve()));
const live = vi.hoisted(() => ({ map: new Map<string, unknown>() }));

vi.mock('./sends', () => ({
  useLiveSends: () => live.map,
  isSending: () => false,
  queueSend,
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

function serve(content: unknown, answers: Record<string, (body: unknown) => Response> = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
      calls.push({ url, method, body });
      const answer = answers[`${method} ${url}`];
      if (answer !== undefined) return Promise.resolve(answer(body));
      if (url === '/v1/creator-space/content') return Promise.resolve(Response.json(content));
      return Promise.resolve(new Response('null', { status: 404 }));
    }),
  );
  return calls;
}

function show(): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ContentPage />
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
  live.map = new Map();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Contenu, the creator’s (CR-06 d)', () => {
  it('hides every empty section but Déposer, whose tiles are Reveal’s, without Script', async () => {
    serve({ requests: [], drops: [] });
    show();
    expect(await screen.findByRole('heading', { level: 2, name: 'Déposer' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'À tourner' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'En route' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Publié' })).toBeNull();
    const tiles = [...document.querySelectorAll('.ct-tile__name')].map((tile) => tile.textContent);
    expect(tiles).toHaveLength(4);
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
    const late = within(section).getByText('En retard depuis mardi');
    expect(late.className).toContain('ct-due--late');
    expect(within(section).getByText('Pour lundi').className).not.toContain('late');
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
    pick(input, [new File(['abc'], 'IMG_0042.HEIC', { type: '' })]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Envoyer' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    const drop = calls.find((call) => call.method === 'POST');
    expect(drop?.body).toMatchObject({ category: 'feed_shoot', files: [{ mime: 'image/heic', bytes: 3 }] });
    expect(queueSend).toHaveBeenCalledTimes(1);
  });

  it('shows each file of a drop on its way, « En préparation » while it is cleaned, « Reprendre » when cut', async () => {
    serve({
      requests: [],
      drops: [
        dropOf({
          state: 'uploading',
          files: [
            fileOf({ position: 0, kind: 'video', mime: 'video/quicktime', state: 'received' }),
            fileOf({ position: 1, kind: 'video', mime: 'video/quicktime', state: 'awaiting' }),
          ],
        }),
      ],
    });
    show();
    const section = (await screen.findByRole('heading', { name: 'En route' })).closest('section');
    if (section === null) throw new Error('no section');
    expect(within(section).getByText('En préparation')).toBeDefined();
    expect(within(section).getByText('Envoi interrompu')).toBeDefined();
    expect(within(section).getByRole('button', { name: 'Reprendre' })).toBeDefined();
    expect(within(section).getByText('En envoi')).toBeDefined();
  });
});
