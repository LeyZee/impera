/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');
const sheet = /\.nv-more \{([^}]*)\}/u.exec(css)?.[1] ?? '';

describe('the « Plus » sheet on a small phone (recette 11/11, SOC-01)', () => {
  it('stays under the top of the screen, above the tab bar', () => {
    expect(sheet).toMatch(
      /max-height: calc\(100dvh - var\(--nv-above-tabbar\) - 10px - max\(14px, env\(safe-area-inset-top, 0px\)\)\);/u,
    );
  });
  it('scrolls inside when its tabs and the account do not fit', () => {
    expect(sheet).toMatch(/overflow-y: auto;/u);
    expect(sheet).toMatch(/overscroll-behavior: contain;/u);
  });
});
