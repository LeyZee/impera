import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./SaveBar.css', import.meta.url), 'utf8');

describe('the save bar of a long sheet (recette 11/11)', () => {
  it('is sticky over `.nv-glass`, which would leave it relative and lifted over the last line', () => {
    expect(css).toMatch(/\.nv-glass\.cr-savebar \{[^}]*position: sticky;/u);
  });

  it('sits above the tab capsule on a phone, with the same weight', () => {
    expect(css).toMatch(/@media \(max-width: 820px\) \{\s*\.nv-glass\.cr-savebar \{[^}]*bottom: calc\(/u);
  });
});
