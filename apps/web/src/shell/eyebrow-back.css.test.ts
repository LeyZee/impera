/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const rule = /\.nv-eyebrow > \.nv-btn--plain \{([^}]*)\}/u.exec(css)?.[1] ?? '';

describe('a way back in the eyebrow (recette design 11/11, CHA-26)', () => {
  it('starts its text on the same line as the title below, by pulling back the small button’s padding', () => {
    expect(rule).toMatch(/margin-inline-start: calc\(-1 \* var\(--nv-space-4\)\);/u);
  });
});
