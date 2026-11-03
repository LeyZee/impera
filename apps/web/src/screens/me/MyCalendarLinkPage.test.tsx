// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MyCalendarLinkPage } from './MyCalendarLinkPage';

import { THEO_ME } from '@/test/pay';

const TOKEN = 'b'.repeat(43);
const PATH = `/v1/calendar-feed/${TOKEN}.ics`;
let live: { createdAt: string } | null;
const writes: string[] = [];

function serve(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      const url = new URL(input, 'http://localhost');
      if (url.pathname !== '/v1/scheduling/calendar-link') {
        return Promise.resolve(new Response('{}', { status: 404 }));
      }
      if (method === 'GET') return Promise.resolve(new Response(JSON.stringify({ link: live })));
      writes.push(method);
      if (method === 'POST') {
        live = { createdAt: '2026-11-03T08:00:00.000Z' };
        return Promise.resolve(
          new Response(JSON.stringify({ path: PATH, createdAt: live.createdAt }), { status: 201 }),
        );
      }
      live = null;
      return Promise.resolve(new Response(null, { status: 204 }));
    }),
  );
}

function renderPage(): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/agenda',
    component: () => <MyCalendarLinkPage user={THEO_ME} />,
  });
  const others = ['/moi/dossier', '/moi/securite'].map((path) =>
    createRoute({ getParentRoute: () => root, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: root.addChildren([page, ...others]),
    history: createMemoryHistory({ initialEntries: ['/moi/agenda'] }),
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
  live = null;
  writes.length = 0;
  serve();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Moi › Agenda (CR-12)', () => {
  it('makes the link once, with Apple’s webcal address, Google’s subscription and the address to copy', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Créer mon lien' }));
    const shown = await screen.findByLabelText('Ton lien de calendrier');
    expect(shown.textContent).toBe(`${window.location.origin}${PATH}`);
    expect(screen.getByRole('link', { name: 'Ajouter à Apple Agenda' }).getAttribute('href')).toBe(
      `webcal://${window.location.host}${PATH}`,
    );
    const google = screen.getByRole('link', { name: 'Ajouter à Google Agenda' });
    expect(google.getAttribute('href')).toBe(
      `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(`webcal://${window.location.host}${PATH}`)}`,
    );
    expect(google.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Copier le lien' })).toBeTruthy();
    // Once put away, the address is not shown again: only since when it works.
    fireEvent.click(screen.getByRole('button', { name: 'C’est fait' }));
    expect(await screen.findByText('Ton lien marche depuis le 3 novembre 2026.')).toBeTruthy();
    expect(screen.queryByText(new RegExp(TOKEN, 'u'))).toBeNull();
    expect(writes).toEqual(['POST']);
  });

  it('stops a live link after saying what it does, and replaces one after the same', async () => {
    live = { createdAt: '2026-11-01T08:00:00.000Z' };
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Couper le lien' }));
    expect(screen.getByText('L’agenda où tu l’as ajouté ne recevra plus tes shifts.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Couper' }));
    expect(await screen.findByRole('button', { name: 'Créer mon lien' })).toBeTruthy();
    expect(writes).toEqual(['DELETE']);

    live = { createdAt: '2026-11-01T08:00:00.000Z' };
    cleanup();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Remplacer le lien' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remplacer' }));
    expect(await screen.findByLabelText('Ton lien de calendrier')).toBeTruthy();
    expect(writes).toEqual(['DELETE', 'POST']);
  });
});
