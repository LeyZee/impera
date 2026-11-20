// @vitest-environment jsdom
import { CreatorIdSchema, type CreatorId, type PlaygroundState } from '@impera/contracts';
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

import { ScriptStrip } from './ScriptStrip';

/* An invented creator: no real data (ADR 0010). */
const MIA = CreatorIdSchema.parse('0199f2a0-0000-7000-8000-0000000000c1');

const unavailable = (code: string, label: string): PlaygroundState['scripts'] => ({
  source: 'trial',
  unavailable: { code, label },
  run: null,
  fictiveSpentCents: 0,
  salesFrozen: false,
});

async function show(scripts: PlaygroundState['scripts'], creatorId: CreatorId | null): Promise<void> {
  const root = createRootRoute({
    component: () => (
      <>
        <ScriptStrip scripts={scripts} creatorId={creatorId} />
        <Outlet />
      </>
    ),
  });
  const pages = ['/entrainer', '/creatrices'].map((at) =>
    createRoute({ getParentRoute: () => root, path: at, component: () => <h1>{at}</h1> }),
  );
  const router = createRouter({
    routeTree: root.addChildren(pages),
    history: createMemoryHistory({ initialEntries: ['/entrainer'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: '/entrainer' });
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('<ScriptStrip>, when none of her scripts can be played', () => {
  it('says it in one short line and leads to « Ses scripts dans Reveal » (avis Design, groupes-medias-1)', async () => {
    await show(unavailable('none_ready', 'Aucun de ses scripts n’est prêt'), MIA);
    expect(
      screen.getByText(/Aucun de ses scripts n’est prêt : les scripts d’essai jouent à la place\./),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Ses scripts dans Reveal' });
    expect(link.getAttribute('href')).toContain('/creatrices');
    expect(link.getAttribute('href')).toContain(MIA);
  });

  it('offers no link where her scripts page would not help: unreadable, or no creator played', async () => {
    await show(unavailable('unreadable', 'Ses scripts ne se lisent pas'), MIA);
    expect(screen.queryByRole('link')).toBeNull();
    cleanup();
    await show(unavailable('none_ready', 'Aucun de ses scripts n’est prêt'), null);
    expect(screen.queryByRole('link')).toBeNull();
  });
});
