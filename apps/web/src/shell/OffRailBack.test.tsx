// @vitest-environment jsdom
import type { Me } from '@impera/contracts';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OffRailBack } from './OffRailBack';
import { railOf, sectionLabel } from './nav';

const base = {
  id: 'u1',
  email: 'membre@example.test',
  name: 'Nora',
  creatorIds: [],
  routedCreatorIds: [],
  shiftCreatorIds: [],
  preferences: { sounds: true },
};
const owner: Me = { ...base, role: 'owner', team: null, teamScope: 'owner' };
const chatter: Me = {
  ...base,
  role: 'operator',
  team: { role: 'chatter', status: 'active' },
  teamScope: 'self',
};
const creator: Me = { ...base, role: 'creator', team: null, teamScope: 'self' };

function renderAs(user: Me, path = '/notifications'): void {
  const root = createRootRouteWithContext<{ user: Me }>()();
  const page = createRoute({ getParentRoute: () => root, path, component: OffRailBack });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    context: { user },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Recette 11/11 (CHA-26, CRE-28): Notifications and the guides opened outside the rail, with no way back.
describe('OffRailBack', () => {
  it.each([
    ['a chatter', chatter],
    ['a creator', creator],
  ])('sends %s back to Moi › Préférences, which opens these pages', async (_, user) => {
    vi.stubGlobal('scrollTo', vi.fn());
    renderAs(user);
    const back = await screen.findByRole('link', { name: '← Moi › Préférences' });
    expect(back.getAttribute('href')).toBe('/moi/preferences');
  });

  it.each([
    ['a chatter', chatter],
    ['a creator', creator],
  ])('sends %s back from the extension’s guide to Moi › Sécurité (CHAT-08)', async (_, user) => {
    vi.stubGlobal('scrollTo', vi.fn());
    renderAs(user, '/aide/extension');
    const back = await screen.findByRole('link', { name: '← Moi › Sécurité' });
    expect(back.getAttribute('href')).toBe('/moi/securite');
  });

  it('sends an account without Moi back to its first tab', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    renderAs(owner);
    const home = railOf(owner).home;
    const back = await screen.findByRole('link', { name: `← ${sectionLabel(home)}` });
    expect(back.getAttribute('href')).toBe(home);
  });

  // Recette visuelle 16/11 (T9): the owner's guides light Réglages, and lead back there.
  it('sends the owner back from a guide to Réglages, the tab it lights', async () => {
    vi.stubGlobal('scrollTo', vi.fn());
    renderAs(owner, '/aide/installer');
    const back = await screen.findByRole('link', { name: '← Réglages' });
    expect(back.getAttribute('href')).toBe('/reglages');
  });
});
