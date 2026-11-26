// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { french } from './Guide';
import { HelpContent } from './HelpPage';
import { HELP, type HelpAudience } from './guides';

afterEach(cleanup);

async function renderPage(audience: HelpAudience): Promise<void> {
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/moi/aide',
    component: () => <HelpContent audience={audience} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: ['/moi/aide'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Les gestes qui demandent un guide' });
}

const AUDIENCES: readonly HelpAudience[] = ['owner', 'manager', 'chatter', 'creator'];

describe('HelpPage', () => {
  it.each(AUDIENCES)('gives the %s their own guides, the first one open', async (audience) => {
    await renderPage(audience);
    const guides = document.querySelectorAll<HTMLDetailsElement>('details.nv-guide');
    expect(guides).toHaveLength(HELP[audience].guides.length);
    expect(guides[0]?.open).toBe(true);
    expect([...guides].slice(1).every((one) => !one.open)).toBe(true);
    expect(document.querySelector('.hp__lead')?.textContent).toBe(french(HELP[audience].lead));
  });

  it('paints the page in the person’s colour, one for every guide', async () => {
    await renderPage('chatter');
    const colours = new Set(
      [...document.querySelectorAll<HTMLElement>('details.nv-guide')].map((one) =>
        one.style.getPropertyValue('--_c'),
      ),
    );
    expect([...colours]).toEqual(['var(--nv-content-5)']);
  });

  it('opens a guide from the jump list', async () => {
    await renderPage('owner');
    const last = HELP.owner.guides.at(-1);
    if (last === undefined) throw new Error('no guide');
    const target = document.getElementById(`guide-${last.id}`);
    if (!(target instanceof HTMLDetailsElement)) throw new Error('no details');
    target.scrollIntoView = () => undefined;
    expect(target.open).toBe(false);
    fireEvent.click(screen.getByRole('link', { name: last.title }));
    expect(target.open).toBe(true);
  });

  it('sets French in French: a no-break space before ; : ? ! » and after «', () => {
    expect(french('Tu tiens les conversations ; le copilote')).toBe(
      'Tu tiens les conversations\u00A0; le copilote',
    );
    expect(french('Partager, « Sur l’écran » ?')).toBe('Partager, «\u00A0Sur l’écran\u00A0»\u00A0?');
  });

  it.each(AUDIENCES)('never lets a French sign start a line alone in the %s’s guide', async (audience) => {
    await renderPage(audience);
    for (const guide of document.querySelectorAll<HTMLDetailsElement>('details')) guide.open = true;
    expect(document.body.textContent.match(/.{30}(?: [;:?!»]|« ).{10}/gu) ?? []).toEqual([]);
  });

  it('writes a key as a key', async () => {
    await renderPage('chatter');
    expect([...document.querySelectorAll('kbd.nv-kbd')].map((key) => key.textContent)).toContain('A');
  });

  it('offers the extension’s guide to the team, never to the creator', async () => {
    await renderPage('chatter');
    expect(screen.getByRole('link', { name: 'Installer l’extension' })).toBeTruthy();
    cleanup();
    await renderPage('creator');
    expect(screen.queryByRole('link', { name: 'Installer l’extension' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Reconnecter Reveal' })).toBeNull();
  });
});

describe('the books', () => {
  const all = AUDIENCES.flatMap((audience) => HELP[audience].guides.map((guide) => ({ audience, guide })));

  it('write only what is on screen today: nothing announced for later', () => {
    const text = JSON.stringify(HELP);
    expect(text).not.toMatch(/Bientôt/u);
  });

  it('give each guide a unique id in its book, and at least one step that proves itself', () => {
    for (const audience of AUDIENCES) {
      const ids = HELP[audience].guides.map((guide) => guide.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const { guide } of all) {
      expect(guide.steps.length).toBeGreaterThan(0);
      expect(guide.steps.every((step) => step.see.trim() !== '')).toBe(true);
    }
  });

  it('never tell a chatter or a creator what only the owner may do with money', () => {
    const team = JSON.stringify([HELP.chatter, HELP.creator]);
    expect(team).not.toMatch(/Marquer payé|Valider les relevés|Changer le taux/u);
  });
});
