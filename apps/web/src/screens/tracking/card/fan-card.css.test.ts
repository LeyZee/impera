import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./fan-card.css', import.meta.url), 'utf8');

describe('the fan card’s rows (recette du 21/11)', () => {
  it('lets a line of « Autres » fill its row everywhere, so that « Retirer » ends on the edge', () => {
    // Outside the pointer's block: on a phone too.
    const pointerEnd = css.indexOf('\n}\n', css.indexOf('@media (hover: hover)'));
    expect(css.indexOf('.tr-card__value.tr-card__other {')).toBeGreaterThan(pointerEnd);
    expect(css).toMatch(/\.tr-card__value\.tr-card__other \{[^}]*flex: 1;/u);
  });

  it('hides an unknown field’s word only under the pointer, where « Ajouter » takes its place', () => {
    expect(css).not.toMatch(/^\s*\.tr-card__empty \{[^}]*visibility: hidden;/mu);
    expect(css).toMatch(/:is\(:hover, :focus-within\) \.tr-card__empty \{\s*visibility: hidden;/u);
  });
});
