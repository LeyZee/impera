/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./shell.css', import.meta.url), 'utf8');

describe('the quiet hours on a phone (recette 07/11, EXT-06)', () => {
  it('gives « De » and « à » one width, so that both hours line up when « à 08:00 » goes under', () => {
    expect(css).toMatch(
      /\.nv-notif__hours > \.nv-notif__hint:first-child,\s*\.nv-notif__end > \.nv-notif__hint:first-child \{\s*min-width: 1\.4em;/u,
    );
  });
});
