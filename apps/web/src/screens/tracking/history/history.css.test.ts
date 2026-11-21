import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./history.css', import.meta.url), 'utf8');

describe('Historique des alertes › filtres (recette 11/11)', () => {
  it('never shrinks a select under its words: on a phone each takes the whole row', () => {
    expect(css).toMatch(/\.hi-filters \.hi-select \{\s*grid-column: 1 \/ -1;\s*min-width: 0;/u);
    expect(css).not.toMatch(/\.hi-select \{[^}]*max-width/u);
  });
});

describe('Historique des alertes › mise en page (recette visuelle 16/11)', () => {
  it('gives the list up to 440–460 px on a computer, never Suivi’s 300, the reading side the rest', () => {
    expect(css).toMatch(
      /@media \(min-width: 900px\) \{\s*\.tr-layout\.hi-layout \{\s*grid-template-columns: minmax\(320px, 460px\) minmax\(360px, 1fr\);/u,
    );
    expect(css).toMatch(
      /@media \(min-width: 1320px\) \{\s*\.tr-layout\.hi-layout \{\s*grid-template-columns: minmax\(360px, 440px\) minmax\(320px, 1fr\) minmax\(240px, 300px\);/u,
    );
  });

  it('puts the chip and « Tout marquer comme vu » on the first row, the selects in halves under on a computer', () => {
    expect(css).toMatch(
      /\.hi-head \{\s*display: grid;\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/u,
    );
    expect(css).toMatch(/\.hi-filters \{\s*display: contents;/u);
    expect(css).toMatch(/\.hi-head__all \{\s*grid-area: 1 \/ 2;\s*justify-self: end;/u);
    expect(css).toMatch(
      /@media \(min-width: 900px\) \{\s*\.hi-filters \.hi-select \{\s*grid-column: auto;\s*grid-row: 2;/u,
    );
  });

  it('says « Vu » in the muted ink, never the faint one', () => {
    expect(css).toMatch(/\.hi-line__seen \{[^}]*color: var\(--nv-ink-muted\);/u);
  });
});
