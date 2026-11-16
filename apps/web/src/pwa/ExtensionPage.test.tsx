// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtensionPage } from './ExtensionPage';
import { browserOf, EXTENSION_ZIP, isLocalCrm } from './extension';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/142.0.0.0`;
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1';

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('browserOf', () => {
  it.each([
    [CHROME, 'chrome'],
    [EDGE, 'edge'],
    [IPHONE, 'other'],
    ['Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/142.0 Mobile Safari/537.36', 'other'],
  ])('reads the browser', (agent, browser) => {
    expect(browserOf(agent)).toBe(browser);
  });
});

/** The page in a router, as the app draws it: its way back is a link. */
async function renderPage(page: JSX.Element): Promise<void> {
  const root = createRootRoute();
  const route = createRoute({ getParentRoute: () => root, path: '/aide/extension', component: () => page });
  const router = createRouter({
    routeTree: root.addChildren([route]),
    history: createMemoryHistory({ initialEntries: ['/aide/extension'] }),
  });
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { name: 'Installer l’extension' });
}

async function renderAs(userAgent: string): Promise<void> {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  await renderPage(<ExtensionPage />);
}

describe('ExtensionPage', () => {
  it('offers the file of the extension', async () => {
    vi.stubEnv('DEV', false);
    await renderAs(CHROME);
    expect(screen.getByRole('link', { name: 'Télécharger l’extension' }).getAttribute('href')).toBe(
      EXTENSION_ZIP,
    );
  });

  it('offers no file a development build does not serve, and names no folder of the code (CHA-15)', async () => {
    vi.stubEnv('DEV', true);
    await renderAs(CHROME);
    expect(screen.queryByRole('link', { name: 'Télécharger l’extension' })).toBeNull();
    expect(screen.getByText(/n’est pas servi/u).textContent).not.toMatch(/apps\/|\.output/u);
  });

  it('shows one list of steps, the browser that opens the page first, the other one a choice away (CHA-15)', async () => {
    await renderAs(EDGE);
    expect(screen.getByRole('heading', { name: 'Dans Edge' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Dans Chrome' })).toBeNull();
    expect(screen.getByText(/edge:\/\/extensions/u)).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Chrome' }));
    expect(screen.getByRole('heading', { name: 'Dans Chrome' })).toBeTruthy();
    expect(screen.getByText(/chrome:\/\/extensions/u)).toBeTruthy();
    expect(screen.queryByText(/edge:\/\/extensions/u)).toBeNull();
  });

  it('sends a phone to the computer', async () => {
    await renderAs(IPHONE);
    expect(screen.getByText(/marche sur ordinateur/u)).toBeTruthy();
  });

  it('says what the extension does, and nothing of what is not there yet (CHA-15)', async () => {
    await renderAs(CHROME);
    expect(
      screen.getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent),
    ).toContain('Tes raccourcis');
    expect(screen.queryByText(/Bientôt/u)).toBeNull();
  });

  it('tells the popup nothing on localhost, its default address', async () => {
    await renderAs(CHROME);
    expect(screen.queryByRole('button', { name: 'Copier l’adresse' })).toBeNull();
    expect(screen.getAllByText(/tu vois ton nom/u)).toHaveLength(1);
  });

  it('gives a deployed CRM its address to paste in the popup', async () => {
    vi.stubGlobal('location', new URL('https://crm.exemple.fr/aide/extension'));
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { userAgent: CHROME, clipboard: { writeText } });
    await renderPage(<ExtensionPage />);
    expect(screen.getAllByText('https://crm.exemple.fr')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Copier l’adresse' }));
    expect(writeText).toHaveBeenCalledWith('https://crm.exemple.fr');
    expect(await screen.findByRole('button', { name: 'Copiée' })).toBeTruthy();
    expect(screen.getAllByText(/l’extension affiche alors ton nom/u)).toHaveLength(1);
  });
});

describe('isLocalCrm', () => {
  it.each([
    ['http://localhost:5173', true],
    ['http://127.0.0.1:5173', true],
    ['https://crm.exemple.fr', false],
  ])('knows the default address', (origin, local) => {
    expect(isLocalCrm(origin)).toBe(local);
  });
});
