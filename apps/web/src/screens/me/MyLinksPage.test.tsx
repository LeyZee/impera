// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyLinksPage } from './MyLinksPage';

const STORY = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Story du jour',
  placement: 'story_daily',
  usageNote: 'À mettre dans ta story du jour',
  url: 'https://liens.example.test/nora/story-du-jour/novembre-2026',
};
const CANAL = {
  id: '00000000-0000-4000-8000-000000000002',
  name: 'Canal',
  placement: 'telegram_channel',
  usageNote: '',
  url: 'https://liens.example.test/canal',
};

function serve(answer: () => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      Promise.resolve(
        new URL(input, 'http://localhost').pathname === '/v1/creator-space/links'
          ? answer()
          : new Response('{}', { status: 404 }),
      ),
    ),
  );
}

/** The browser's clipboard for one test: jsdom has none. */
function withClipboard(writeText: (text: string) => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
}

function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({ getParentRoute: () => root, path: '/moi/liens', component: MyLinksPage });
  const others = ['/moi/persona', '/moi/trophees', '/moi/securite', '/moi/preferences'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/moi/liens'] }),
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Mes liens', () => {
  it('shows one card per link, with where it goes and what it is for, and no figure', async () => {
    serve(() => new Response(JSON.stringify({ links: [STORY, CANAL] })));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Story du jour' })).toBeTruthy();
    expect(screen.getByText('À mettre dans ta story du jour')).toBeTruthy();
    expect(screen.getByText('Canal Telegram')).toBeTruthy();
    // « Story du jour » placed in the story of the day: the name says it, no chip repeats it.
    expect(screen.getAllByText('Story du jour')).toHaveLength(1);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    // The whole address is what a screen reader hears; the eye reads it cut in its middle.
    expect(screen.getByLabelText(STORY.url).textContent).toContain('…');
    expect(document.body.textContent).not.toMatch(/clic|abonn|\d+\s?%/iu);
  });

  it('copies the whole address and says so, then offers the copy again', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    withClipboard(writeText);
    serve(() => new Response(JSON.stringify({ links: [STORY] })));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Copier/u }));
    expect(writeText).toHaveBeenCalledWith(STORY.url);
    expect(await screen.findByRole('button', { name: 'Copié' })).toBeTruthy();
    await waitFor(
      () => {
        expect(screen.getByRole('button', { name: /Copier/u })).toBeTruthy();
      },
      { timeout: 3_000 },
    );
  });

  it('selects the address and says to copy it by hand when the browser refuses', async () => {
    withClipboard(() => Promise.reject(new Error('refused')));
    serve(() => new Response(JSON.stringify({ links: [STORY] })));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Copier/u }));
    expect(await screen.findByRole('button', { name: 'Sélectionné : copie-le à la main' })).toBeTruthy();
    expect(screen.getByLabelText(STORY.url).textContent).toBe(STORY.url);
  });

  it('says so when the agency placed no link yet', async () => {
    serve(() => new Response(JSON.stringify({ links: [] })));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Pas encore de lien' })).toBeTruthy();
  });

  it('says the server does not answer, and reads again on « Réessayer »', async () => {
    let down = true;
    serve(() =>
      down ? new Response('{}', { status: 503 }) : new Response(JSON.stringify({ links: [CANAL] })),
    );
    renderPage();
    const retry = await screen.findByRole('button', { name: 'Réessayer' });
    down = false;
    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { name: 'Canal' })).toBeTruthy();
  });
});
