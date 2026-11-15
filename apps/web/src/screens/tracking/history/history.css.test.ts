import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./history.css', import.meta.url), 'utf8');

describe('Historique des alertes › filtres (recette 11/11)', () => {
  it('never shrinks a select under its words: « Toutes les créatrices » goes to the next line instead', () => {
    expect(css).toMatch(/\.hi-filters \{[^}]*flex-wrap: wrap;/u);
    expect(css).toMatch(/\.hi-filters \.hi-select \{[^}]*min-width: 10\.5rem;/u);
  });
});
