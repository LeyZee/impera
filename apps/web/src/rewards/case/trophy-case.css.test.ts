/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./trophy-case.css', import.meta.url), 'utf8');
const phone = css.slice(css.indexOf('@media (max-width: 640px)'));
const voirTout = /\.tc-all \{([^}]*)\}/u.exec(phone)?.[1] ?? '';

describe('the case on a phone (recette 16/11, CRE-14)', () => {
  it('gives « Voir tout » a thumb’s target of 44 px', () => {
    expect(voirTout).toMatch(/min-height: 44px/u);
  });

  it('lays a shelf three objects to a row', () => {
    expect(phone).toMatch(/\.tc-slot \{\s*width: 33\.33%;/u);
  });
});
