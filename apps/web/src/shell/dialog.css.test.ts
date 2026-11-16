/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./dialog.css', import.meta.url), 'utf8');
const rule = /\.tm-dialog\.nv-glass \{([^}]*)\}/u.exec(css)?.[1] ?? '';

describe('the dialog over a page of text (recette design 11/11)', () => {
  it('lays its glass on a near-opaque ground, so the page behind cannot be read through it', () => {
    expect(rule).toMatch(/color-mix\(in srgb, var\(--nv-surface-raised\) 94%, transparent\)/u);
  });
});
