/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./agenda.css', import.meta.url), 'utf8');
const rule = /\.nv-field__control\.ag-area \{([^}]*)\}/u.exec(css)?.[1] ?? '';

describe('the growing text field of the agenda (recette design 11/11, CRE-30)', () => {
  it('outweighs the design system field so its starting height holds', () => {
    expect(css).not.toMatch(/^\.ag-area \{/mu);
    expect(rule).toMatch(/min-height: 72px;/u);
    expect(rule).toMatch(/max-height: 240px;/u);
  });
  it('has no browser resize handle', () => {
    expect(rule).toMatch(/resize: none;/u);
  });
});
