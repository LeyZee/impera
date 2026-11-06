// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { act, useState, type JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SubNav, type SubNavItem } from './layout';

const placeTabBarLens = vi.fn();
vi.mock('@impera/design-system', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@impera/design-system')>()),
  placeTabBarLens: (...args: unknown[]) => {
    placeTabBarLens(...args);
  },
}));

let setItems: (items: readonly SubNavItem[]) => void = () => undefined;
/** What the sub-nav watches for a change of size, and what it is told then. */
const watched = new Set<Element>();
let resized: () => void = () => undefined;

function renderNav(first: readonly SubNavItem[]): void {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/paie/quinzaine',
    component: function Page() {
      return <Nav first={first} />;
    },
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/paie/quinzaine'] }),
  });
  render(<RouterProvider router={router} />);
}

function Nav({ first }: { first: readonly SubNavItem[] }): JSX.Element {
  const [items, set] = useState(first);
  setItems = set;
  return <SubNav items={items} label="Paie" />;
}

beforeEach(() => {
  placeTabBarLens.mockClear();
  watched.clear();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(told: () => void) {
        resized = told;
      }
      observe = (target: Element): void => {
        watched.add(target);
      };
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('SubNav', () => {
  it('moves its thumb again when a count arrives and widens a tab', async () => {
    const releves: SubNavItem = { to: '/paie/releves', label: 'Relevés' };
    renderNav([{ to: '/paie/quinzaine', label: 'Quinzaine' }, releves]);
    await screen.findByRole('link', { name: 'Quinzaine' });
    const before = placeTabBarLens.mock.calls.length;
    expect(before).toBeGreaterThan(0);
    act(() => {
      setItems([{ to: '/paie/quinzaine', label: 'Quinzaine', count: 4 }, releves]);
    });
    expect(screen.getByText('4').className).toBe('nv-subnav__count');
    expect(placeTabBarLens.mock.calls.length).toBeGreaterThan(before);
  });

  // Relecture d'Équipe (#567): on a phone, a tab widened by its count pushed « Exports » out of view, cut without fade.
  it('fades the edge a tab pushes out of view when it widens, the nav itself the same width', async () => {
    const releves: SubNavItem = { to: '/paie/releves', label: 'Relevés' };
    renderNav([{ to: '/paie/quinzaine', label: 'Quinzaine' }, releves]);
    const tab = await screen.findByRole('link', { name: 'Quinzaine' });
    const nav = screen.getByRole('navigation', { name: 'Paie' });
    expect(nav.dataset['more']).toBe('none');
    expect(watched.has(tab)).toBe(true);
    Object.defineProperty(nav, 'clientWidth', { configurable: true, value: 358 });
    Object.defineProperty(nav, 'scrollWidth', { configurable: true, value: 420 });
    act(() => {
      resized();
    });
    expect(nav.dataset['more']).toBe('end');
  });

  it('slides from the tab just left when a sub-tab draws the sub-nav anew', async () => {
    const items: readonly SubNavItem[] = [
      { to: '/paie/quinzaine', label: 'Quinzaine' },
      { to: '/paie/releves', label: 'Relevés' },
    ];
    const root = createRootRoute();
    // Each screen draws its own sub-nav, as Paie's do: going from one to the other mounts a new one.
    const screenOf = (path: string) =>
      createRoute({
        getParentRoute: () => root,
        path,
        component: function Screen() {
          return <SubNav items={items} label="Paie (glisse)" />;
        },
      });
    const router = createRouter({
      routeTree: root.addChildren([screenOf('/paie/quinzaine'), screenOf('/paie/releves')]),
      history: createMemoryHistory({ initialEntries: ['/paie/quinzaine'] }),
    });
    render(<RouterProvider router={router} />);
    await screen.findByRole('link', { name: 'Quinzaine' });
    placeTabBarLens.mockClear();
    await act(async () => {
      await router.navigate({ to: '/paie/releves' });
    });
    // The new sub-nav puts its thumb still under the tab just left, then slides it, thumb passed, to the new one.
    const relevés = screen.getByRole('link', { name: 'Relevés' });
    const at = placeTabBarLens.mock.calls.findIndex((call) => call[1] === relevés && call.length === 3);
    expect(at).toBeGreaterThan(0);
    expect(placeTabBarLens.mock.calls[at - 1]?.[1]).toBe(screen.getByRole('link', { name: 'Quinzaine' }));
  });
});
