// @vitest-environment jsdom
import { ReelBriefSchema } from '@impera/contracts';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ReelBrief, reelLength } from './ReelBrief';
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

describe('her reel sheet, drawn (VEI-08, ADR 0082 § 3)', () => {
  it('shows her first sentence big, the frame with its text, the shots in order, the end and the length', () => {
    render(<ReelBrief brief={sheet} />);
    const hook = screen.getByRole('region', { name: 'Ta première phrase' });
    expect(hook.querySelector('q')?.textContent).toBe('Devine ce que je prépare ce soir');
    const frame = screen.getByRole('img');
    expect(frame.getAttribute('aria-label')).toBe(
      'Cadre vertical du reel. Le texte « Soirée miroir » au centre, dans la zone claire. Le haut, le bas et le bord droit, grisés, sont cachés par Instagram.',
    );
    expect(frame.textContent).toBe('Soirée miroir');
    expect(screen.getByText('Garde ton texte dans la zone claire')).toBeDefined();
    const shots = within(screen.getByRole('region', { name: 'Ce que tu filmes' })).getAllByRole('listitem');
    expect(shots.map((shot) => shot.textContent)).toEqual([
      '1Reflet dans le miroir',
      '2Tenue de soirée, regard caméra',
    ]);
    expect(screen.getByRole('region', { name: 'Pour finir' }).textContent).toContain(
      'Retour au miroir du début',
    );
    expect(screen.getByText('≈ 20 s')).toBeDefined();
  });

  it('leaves out what is not written: no text on screen, no end', () => {
    render(<ReelBrief brief={{ ...sheet, onScreen: null, ending: null }} />);
    expect(screen.getByRole('img').textContent).toBe('');
    expect(screen.getByText('Pas de texte à l’écran')).toBeDefined();
    expect(screen.queryByRole('region', { name: 'Pour finir' })).toBeNull();
  });

  it('never says the words of the agency', () => {
    const { container } = render(<ReelBrief brief={sheet} />);
    const words = `${container.textContent} ${screen.getByRole('img').getAttribute('aria-label') ?? ''}`;
    expect(words).not.toMatch(/accroche|hook|boucle|signal|score|\bIA\b/iu);
  });

  it('says a length in seconds, then in minutes', () => {
    expect([reelLength(20), reelLength(60), reelLength(90)]).toEqual(['≈ 20 s', '≈ 1 min', '≈ 1 min 30']);
  });
});

describe('her shooting sheet with a reel sheet', () => {
  it('draws the reel sheet first and keeps the free text under it', () => {
    render(<ShootBrief brief="Lumière douce, tenue noire" reel={sheet} folded={false} />);
    const brief = screen.getByRole('region', { name: 'Fiche de tournage' });
    expect(within(brief).getByRole('img')).toBeDefined();
    expect(brief.lastElementChild?.textContent).toBe('Lumière douce, tenue noire');
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
