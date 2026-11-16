// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InstallNudge } from './InstallNudge';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1';

/** The card above a page, as the shell draws it, at `path`. */
async function renderAt(path: string): Promise<void> {
  const root = createRootRoute({
    component: () => (
      <>
        <InstallNudge />
        <Outlet />
      </>
    ),
  });
  const pages = ['/aujourdhui', '/notifications', '/aide/installer'].map((at) =>
    createRoute({ getParentRoute: () => root, path: at, component: () => <h1>{at}</h1> }),
  );
  const router = createRouter({
    routeTree: root.addChildren(pages),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: path });
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE);
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('InstallNudge', () => {
  it('heads a page on an iPhone that does not run the installed app', async () => {
    await renderAt('/aujourdhui');
    expect(screen.getByRole('complementary', { name: 'Installer Impera' })).toBeTruthy();
  });

  // Recette 11/11 (CRE-36): on Notifications, the card said twice what « Cet appareil » offers below it.
  it.each(['/notifications', '/aide/installer'])(
    'stays off %s, which offers the install itself',
    async (path) => {
      await renderAt(path);
      expect(screen.queryByRole('complementary', { name: 'Installer Impera' })).toBeNull();
    },
  );
});
