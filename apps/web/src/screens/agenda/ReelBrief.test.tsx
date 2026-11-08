// @vitest-environment jsdom
import { ReelBriefSchema } from '@impera/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ReelBrief, reelLength, shotLength } from './ReelBrief';
import { ShootBrief } from './ShootBrief';

// Invented sentences only (ADR 0010).
const sheet = ReelBriefSchema.parse({
  hook: 'Devine ce que je prépare ce soir',
  onScreen: 'Soirée miroir',
  shots: ['Reflet dans le miroir', 'Tenue de soirée, regard caméra'],
  ending: 'Retour au miroir du début',
  seconds: 20,
});

afterEach(cleanup);

describe('her reel sheet, in steps beside her reel (VEI-08, ADR 0082 § 3)', () => {
  it('gives her the steps in the order she shoots, and her reel on a phone', () => {
    render(<ReelBrief brief={sheet} />);
    expect(screen.getByText('≈ 20 s')).toBeDefined();
    expect(screen.getByText('2 plans')).toBeDefined();
    const steps = screen.getAllByRole('heading', { level: 4 }).map((step) => step.textContent);
    expect(steps).toEqual([
      'Commence par dire',
      'Puis filme, dans l’ordre≈ 10 s chacun',
      'Termine par',
      'Ajoute ce texte à l’écran',
    ]);
    const said = screen.getByRole('region', { name: 'Commence par dire' });
    expect(said.querySelector('q')?.textContent).toBe('Devine ce que je prépare ce soir');
    const shots = within(screen.getByRole('region', { name: 'Puis filme, dans l’ordre' })).getAllByRole(
      'listitem',
    );
    expect(shots.map((shot) => shot.textContent)).toEqual([
      'Reflet dans le miroir',
      'Tenue de soirée, regard caméra',
    ]);
    expect(screen.getByRole('region', { name: 'Termine par' }).textContent).toContain(
      'Retour au miroir du début',
    );
    const phone = screen.getByRole('img');
    expect(phone.getAttribute('aria-label')).toBe(
      'Aperçu de ton reel sur un téléphone. Ton texte « Soirée miroir » au milieu de l’image, là où rien ne le recouvre. Les boutons à droite, ta légende en bas et le titre en haut recouvrent le reste.',
    );
    expect(phone.querySelector('.ag-phone__text')?.textContent).toBe('Soirée miroir');
    expect(phone.textContent).toContain('Ta légende s’affiche ici');
  });

  it('leaves out what is not written: no text on screen, no end, and numbers what is left', () => {
    render(<ReelBrief brief={{ ...sheet, onScreen: null, ending: null }} />);
    expect(screen.getByRole('img').querySelector('.ag-phone__text')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Termine par' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Ajoute ce texte à l’écran' })).toBeNull();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(2);
  });

  it('never says the words of the agency', () => {
    const { container } = render(<ReelBrief brief={sheet} />);
    const words = `${container.textContent} ${screen.getByRole('img').getAttribute('aria-label') ?? ''}`;
    expect(words).not.toMatch(/accroche|hook|boucle|signal|score|\bIA\b/iu);
  });

  it('says a length in seconds, then in minutes, and a shot’s share of it', () => {
    expect([reelLength(20), reelLength(60), reelLength(90)]).toEqual(['≈ 20 s', '≈ 1 min', '≈ 1 min 30']);
    expect([shotLength(20, 3), shotLength(5, 6)]).toEqual(['≈ 7 s', '≈ 1 s']);
  });
});

describe('her shooting sheet with a reel sheet', () => {
  it('draws the reel sheet first and keeps the free text under it', () => {
    render(<ShootBrief brief="Lumière douce, tenue noire" reel={sheet} folded={false} />);
    const brief = screen.getByRole('region', { name: 'Fiche de tournage' });
    expect(within(brief).getByRole('img')).toBeDefined();
    const more = within(brief).getByRole('region', { name: 'À savoir aussi' });
    expect(brief.lastElementChild).toBe(more);
    expect(more.querySelector('p')?.textContent).toBe('Lumière douce, tenue noire');
  });

  it('shows a sheet without a reel sheet exactly as before', () => {
    const { container } = render(<ShootBrief brief="Lumière douce" folded />);
    expect(container.innerHTML).toBe(
      '<details class="ag-brief"><summary class="ag-brief__title">🎬 Fiche de tournage</summary><p class="ag-brief__text">Lumière douce</p></details>',
    );
  });

  it('shows a reel sheet without free text, folded on a proposal', () => {
    render(<ShootBrief brief={null} reel={sheet} folded />);
    expect(screen.getByText('🎬 Fiche de tournage').tagName).toBe('SUMMARY');
    expect(screen.getByRole('img', { hidden: true })).toBeDefined();
  });
});
