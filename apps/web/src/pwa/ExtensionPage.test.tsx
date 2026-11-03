// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExtensionPage } from './ExtensionPage';
import { browserOf, EXTENSION_ZIP, isLocalCrm } from './extension';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const EDGE = `${CHROME} Edg/142.0.0.0`;
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 Version/19.0 Mobile/15E148 Safari/604.1';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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

function renderAs(userAgent: string, watches = true): void {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  render(<ExtensionPage watches={watches} />);
}

describe('ExtensionPage', () => {
  it('offers the file of the extension', () => {
    renderAs(CHROME);
    expect(screen.getByRole('link', { name: 'Télécharger l’extension' }).getAttribute('href')).toBe(
      EXTENSION_ZIP,
    );
  });

  it('puts the steps of the browser that opens the page first', () => {
    renderAs(EDGE);
    const titles = screen.getAllByRole('heading').map((heading) => heading.textContent);
    expect(titles.indexOf('Dans Edge')).toBeLessThan(titles.indexOf('Dans Chrome'));
    expect(screen.getByText(/edge:\/\/extensions/u)).toBeTruthy();
  });

  it('sends a phone to the computer', () => {
    renderAs(IPHONE);
    expect(screen.getByText(/marche sur ordinateur/u)).toBeTruthy();
  });

  it('says what is not there yet', () => {
    renderAs(CHROME);
    expect(screen.getAllByText('Bientôt')).toHaveLength(2);
  });

  it('keeps the trend watch for those who do it', () => {
    renderAs(CHROME, false);
    expect(screen.queryByText('La veille Instagram')).toBeNull();
    expect(screen.getByText('Le fan sous les yeux')).toBeTruthy();
  });

  it('tells the popup nothing on localhost, its default address', () => {
    renderAs(CHROME);
    expect(screen.queryByRole('button', { name: 'Copier l’adresse' })).toBeNull();
    expect(screen.getAllByText(/tu vois ton nom/u)).toHaveLength(2);
  });

  it('gives a deployed CRM its address to paste in the popup', async () => {
    vi.stubGlobal('location', new URL('https://crm.exemple.fr/aide/extension'));
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { userAgent: CHROME, clipboard: { writeText } });
    render(<ExtensionPage watches />);
    expect(screen.getAllByText('https://crm.exemple.fr')).toHaveLength(2);
    const [copy] = screen.getAllByRole('button', { name: 'Copier l’adresse' });
    if (copy === undefined) throw new Error('no copy button');
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('https://crm.exemple.fr');
    expect(await screen.findByRole('button', { name: 'Copiée' })).toBeTruthy();
    expect(screen.getAllByText(/l’extension affiche alors ton nom/u)).toHaveLength(2);
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
