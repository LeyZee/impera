// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtensionLinkPage } from './ExtensionLinkPage';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/142.0.0.0`;

async function renderAt(address: string, userAgent = CHROME): Promise<void> {
  vi.stubGlobal('location', new URL(address));
  vi.stubGlobal('navigator', { userAgent });
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/extension/lier',
    component: ExtensionLinkPage,
  });
  const guide = createRoute({ getParentRoute: () => root, path: '/aide/extension', component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([page, guide]),
    history: createMemoryHistory({ initialEntries: ['/extension/lier'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExtensionLinkPage', () => {
  it('says where to click, then the case of the icon behind the puzzle', async () => {
    await renderAt('https://crm.exemple.fr/extension/lier');
    expect(await screen.findByRole('heading', { name: 'Relier l’extension à ce CRM' })).toBeDefined();
    expect(screen.getByText('Clique sur l’icône Impera en haut à droite de ton navigateur.')).toBeDefined();
    expect(screen.getByText('Pas épinglée : la pièce de puzzle, puis Impera.')).toBeDefined();
    expect(screen.getAllByRole('img')).toHaveLength(2);
  });

  it('quotes the popup’s question with this CRM’s full host', async () => {
    await renderAt('https://crm.exemple.fr/extension/lier');
    expect(await screen.findByText(/« Relier l’extension à crm\.exemple\.fr \? »/u)).toBeDefined();
  });

  it('names this computer on localhost, as the popup does', async () => {
    await renderAt('http://localhost:5173/extension/lier');
    expect(await screen.findByText(/« Relier l’extension au CRM de cet ordinateur \? »/u)).toBeDefined();
  });

  // EXT-09: this computer's CRM is allowed at the install, the browser asks nothing there.
  it('speaks of the browser’s question only where the browser asks one', async () => {
    await renderAt('http://localhost:5173/extension/lier');
    const local = await screen.findByText(/Clique « Relier »/u);
    expect(local.textContent).toMatch(/Clique « Relier »\.$/u);
    cleanup();
    await renderAt('https://crm.exemple.fr/extension/lier');
    expect((await screen.findByText(/Clique « Relier »/u)).textContent).toContain(
      'puis accepte la question du navigateur.',
    );
  });

  // Avis Design du 19/11: « la barre de Chrome » was wrong in Edge; the browser is not named, in either.
  it('says the same in Edge as in Chrome, naming no browser', async () => {
    await renderAt('https://crm.exemple.fr/extension/lier', EDGE);
    expect(await screen.findByText('Épinglée : elle est dans la barre du navigateur.')).toBeDefined();
    expect(screen.queryByText(/Edge|Chrome/u)).toBeNull();
  });

  it('puts each caption above its sketch', async () => {
    await renderAt('https://crm.exemple.fr/extension/lier');
    await screen.findByRole('heading', { name: 'Relier l’extension à ce CRM' });
    const figures = [...document.querySelectorAll('figure')];
    expect(figures).toHaveLength(2);
    for (const figure of figures) expect(figure.firstElementChild?.tagName).toBe('FIGCAPTION');
  });

  it('says what an already linked extension does, and goes back to the guide it came from', async () => {
    await renderAt('https://crm.exemple.fr/extension/lier');
    expect(await screen.findByText(/Ton extension est peut-être déjà reliée/u)).toBeDefined();
    expect(screen.getByRole('link', { name: '← Extension' }).getAttribute('href')).toBe('/aide/extension');
  });
});
