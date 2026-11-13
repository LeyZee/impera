import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./tracking.css', import.meta.url), 'utf8');

describe('a conversation in a narrow list (recette 07/11, EXT-02)', () => {
  it('measures the list, not the window: the side column of a computer is as narrow as a phone', () => {
    expect(css).toMatch(/\.tr-groups \.tr-list \{\s*container-type: inline-size;/u);
  });

  it('sends the state pill under the pseudo there, so the pseudo is never cut to « f… »', () => {
    const narrow = /@container \(max-width: 480px\) \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(
      /\.tr-groups \.tr-row\.nv-convo \{\s*grid-template-columns: auto minmax\(0, 1fr\);/u,
    );
    expect(narrow).toMatch(/\.tr-groups \.tr-row\.nv-convo > \.nv-convo__side \{\s*grid-column: 2;/u);
  });

  it('cuts a creator’s long name before the pseudo, with « … »', () => {
    const narrow = /@container \(max-width: 480px\) \{([\s\S]*?)\n\}/u.exec(css)?.[1] ?? '';
    expect(narrow).toMatch(/\.tr-groups \.tr-row__pseudo \{\s*flex: 0 0 auto;/u);
    expect(narrow).toMatch(
      /\.tr-groups \.tr-row__creator \{[^}]*display: block;[^}]*flex: 0 1 auto;[^}]*text-overflow: ellipsis/u,
    );
  });
});

describe('the reader and the draft never put words over each other (recette 11/11)', () => {
  it('lets the mode go under a long state rather than under « Reprendre la main »', () => {
    expect(css).toMatch(/\.tr-reader__state \{[^}]*flex-wrap: wrap;/u);
  });

  it('cuts a long state inside its pill on a phone rather than under « Reprendre la main »', () => {
    expect(css).toMatch(/\.tr-reader__state > \.nv-status \{\s*min-width: 0;\s*max-width: 100%;/u);
    expect(css).toMatch(/\.tr-reader__state-label \{[^}]*text-overflow: ellipsis;/u);
  });

  it('gives the hand its own line on a phone when a send failed, so the state is read whole', () => {
    expect(css).toMatch(/\.tr-reader__top \.tr-reader__head--long \{\s*flex-wrap: wrap;/u);
  });

  it('gives « Envoyer la retouche » its own row while retouching', () => {
    expect(css).toMatch(/\.tr-draft__actions--editing \{\s*flex-wrap: wrap;/u);
    expect(css).toMatch(/\.tr-draft__actions--editing > \.nv-btn--neon \{\s*flex-basis: 100%;/u);
  });
});
