// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Page, PageHeader } from './layout';

afterEach(() => {
  cleanup();
});

/** The header's own children, by class: what the template lays out. */
const parts = (): string[] =>
  [...(document.querySelector('.nv-page__head')?.children ?? [])].map((child) => child.className);

// Recette visuelle 16/11 (COH-01, T1): one template for every page's header.
describe('PageHeader', () => {
  it('puts the section’s tabs on a row of their own, after the title block and the buttons', () => {
    render(
      <PageHeader
        eyebrow="Paie"
        title="Quinzaine"
        lead="Relis chaque relevé, puis valide-les."
        actions={<button type="button">Valider</button>}
        tabs={<nav aria-label="Paie">onglets</nav>}
      />,
    );
    expect(parts()).toEqual(['nv-page__title', 'nv-page__actions', 'nv-page__tabs']);
    const tabs = screen.getByRole('navigation', { name: 'Paie' });
    expect(tabs.parentElement?.className).toBe('nv-page__tabs');
    expect(screen.getByRole('button', { name: 'Valider' }).parentElement?.className).toBe('nv-page__actions');
    // The header says it has tabs: the stylesheet keeps their row in place from one tab to the next.
    expect(document.querySelector('.nv-page__head')?.hasAttribute('data-tabs')).toBe(true);
  });

  it('has no row of tabs, nor its mark, without tabs', () => {
    render(<PageHeader eyebrow="Paie" title="Quinzaine" actions={<button type="button">Valider</button>} />);
    expect(parts()).toEqual(['nv-page__title', 'nv-page__actions']);
    expect(document.querySelector('.nv-page__tabs')).toBeNull();
    expect(document.querySelector('.nv-page__head')?.hasAttribute('data-tabs')).toBe(false);
  });

  it('draws the same title block with or without tabs and buttons', () => {
    const block = (): string => document.querySelector('.nv-page__title')?.outerHTML ?? '';
    render(<PageHeader eyebrow="Moi" title="Profil" lead="Ce que l’agence sait de toi." />);
    const alone = block();
    cleanup();
    render(
      <PageHeader
        eyebrow="Moi"
        title="Profil"
        lead="Ce que l’agence sait de toi."
        actions={<button type="button">Modifier</button>}
        tabs={<nav aria-label="Moi">onglets</nav>}
      />,
    );
    expect(block()).toBe(alone);
    expect(alone).toContain('<h1>Profil</h1>');
    expect(document.querySelector('.nv-page__title > .nv-eyebrow')?.textContent).toBe('Moi');
  });

  it('never puts a tab inside the buttons', () => {
    render(<PageHeader title="Réglages" tabs={<nav aria-label="Réglages">onglets</nav>} />);
    expect(document.querySelector('.nv-page__actions')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Réglages' }).closest('.nv-page__actions')).toBeNull();
  });
});

// Recette visuelle 16/11 (COH-02, T3): two widths, set by the page, the wide one by default.
describe('Page', () => {
  it('is wide unless told narrow', () => {
    render(<Page>contenu</Page>);
    expect(document.querySelector('.nv-page')?.getAttribute('data-width')).toBe('wide');
    cleanup();
    render(<Page width="narrow">contenu</Page>);
    expect(document.querySelector('.nv-page')?.getAttribute('data-width')).toBe('narrow');
  });

  it('keeps a screen’s own class beside its width', () => {
    render(
      <Page className="tr-page" width="narrow">
        contenu
      </Page>,
    );
    const page = document.querySelector('.nv-page');
    expect(page?.classList.contains('tr-page')).toBe(true);
    expect(page?.getAttribute('data-width')).toBe('narrow');
  });
});
