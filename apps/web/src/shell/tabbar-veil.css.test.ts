/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');

describe('the tab bar of the phone over a scrolling page (recette design 12/11)', () => {
  it('veils the page at 96 %, so no word behind shows between its labels, by day as by night', () => {
    expect(css).toMatch(
      /--_blur: var\(--nv-blur-thick\);\s+background:\s+linear-gradient\([^;]*\),\s+color-mix\(in srgb, var\(--nv-void\) 96%, transparent\);/u,
    );
  });
});
