// @vitest-environment jsdom
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ExtensionPage } from './ExtensionPage';
import { browserOf, EXTENSION_ZIP } from './extension';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/142.0.0.0`;
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1';

/** The CRM's answer for the extension's file: the zip, or the page a server answers for what it does not have. */
function serves(zip: boolean): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { 'content-type': zip ? 'application/zip' : 'text/html' },
        }),
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal('scrollTo', vi.fn());
  serves(true);
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

async function renderAs(userAgent: string, watches = true): Promise<void> {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  await renderPage(<ExtensionPage watches={watches} />);
}

describe('ExtensionPage', () => {
  it('offers the file of the extension', async () => {
    await renderAs(CHROME);
    expect((await screen.findByRole('link', { name: 'Télécharger l’extension' })).getAttribute('href')).toBe(
      EXTENSION_ZIP,
    );
  });

  // V-CHA, recette du 16/11: a link to a file that is not served downloads an error page.
  it('offers no download when this CRM does not serve the file', async () => {
    serves(false);
    await renderAs(CHROME);
    expect(await screen.findByText(/le fichier n’est pas servi/u)).toBeDefined();
    expect(screen.queryByRole('link', { name: 'Télécharger l’extension' })).toBeNull();
  });

  it('puts the steps of the browser that opens the page first', async () => {
    await renderAs(EDGE);
    const titles = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(titles.indexOf('Dans Edge')).toBeLessThan(titles.indexOf('Dans Chrome'));
    expect(screen.getByText(/edge:\/\/extensions/u)).toBeTruthy();
  });

  it('sends a phone to the computer', async () => {
    await renderAs(IPHONE);
    expect(screen.getByText(/marche sur ordinateur/u)).toBeTruthy();
  });

  // Recette du 16/11, EXT-06: the copilot exists, nothing is announced as coming.
  it('says what the extension does today, the copilot on Reveal included', async () => {
    await renderAs(CHROME);
    expect(screen.queryByText(/Bientôt/u)).toBeNull();
    const offers = screen.getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent);
    expect(offers).toContain('Tes raccourcis');
    expect(offers).toContain('Le copilote sur Reveal');
    expect(offers).toContain('La veille Instagram');
    expect(screen.getByRole('heading', { name: 'Le copilote sur Reveal' })).toBeDefined();
    expect(screen.getByText(/Trois touches : A copie le brouillon pour Reveal/u)).toBeDefined();
  });

  it('keeps the trend watch for those who do it', async () => {
    await renderAs(CHROME, false);
    expect(screen.queryByText(/veille Instagram/u)).toBeNull();
    expect(screen.getAllByText('Le copilote sur Reveal').length).toBeGreaterThan(0);
  });

  // ADR 0067, amendement du 19/11: nothing to type, the popup links itself from the CRM's own page.
  it('leads each browser’s steps to the CRM’s link page, with no address to paste', async () => {
    await renderAs(CHROME);
    const links = screen.getAllByRole('link', { name: 'Relier l’extension à ce CRM' });
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('/extension/lier');
    expect(screen.queryByRole('button', { name: 'Copier l’adresse' })).toBeNull();
    expect(screen.getAllByText(/l’extension affiche alors ton nom/u)).toHaveLength(2);
  });

  // ADR 0067, second amendement: the extension this CRM built knows its address, so there is nothing to link.
  it('drops the link step when the served extension was built for this CRM', async () => {
    vi.stubEnv('VITE_EXTENSION_CRM_ORIGIN', window.location.origin);
    await renderAs(CHROME);
    expect(screen.queryByRole('link', { name: 'Relier l’extension à ce CRM' })).toBeNull();
    // The last step says what to do, and no longer « alors » after a step that is gone (avis Design du 19/11).
    expect(screen.getAllByText('Clique sur l’icône Impera : elle affiche ton nom.')).toHaveLength(2);
    expect(screen.queryByText(/l’extension affiche alors ton nom/u)).toBeNull();
  });

  it('keeps the link step when the extension was built for another address', async () => {
    vi.stubEnv('VITE_EXTENSION_CRM_ORIGIN', 'https://autre.exemple.fr');
    await renderAs(CHROME);
    expect(screen.getAllByRole('link', { name: 'Relier l’extension à ce CRM' })).toHaveLength(2);
    expect(screen.getAllByText(/l’extension affiche alors ton nom/u)).toHaveLength(2);
    expect(screen.queryByText('Clique sur l’icône Impera : elle affiche ton nom.')).toBeNull();
  });
});
