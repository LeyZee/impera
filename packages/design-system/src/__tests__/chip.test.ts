import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');

describe('nv-chip', () => {
  it('keeps a checked chip filled under the pointer, and lightens none under a finger', () => {
    // Every hover rule of a chip leaves the checked ones out: a hover is more specific than `[aria-checked]`.
    const hovers = css.match(/^[^{}\n]*\.nv-chip:hover[^{]*\{/gmu) ?? [];
    expect(hovers.length).toBeGreaterThan(0);
    for (const rule of hovers) {
      expect(rule).toContain("[aria-checked='true']");
      expect(rule).toContain("[aria-pressed='true']");
    }
    // And only where a pointer hovers: on a phone the hover sticks after the tap.
    const start = css.indexOf('@media (hover: hover)');
    expect(start).toBeGreaterThan(-1);
    expect(css.indexOf('.nv-chip:hover', start)).toBeGreaterThan(start);
    expect(css.slice(0, start)).not.toContain('.nv-chip:hover');
  });
});
