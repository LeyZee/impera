/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./billing.css', import.meta.url), 'utf8');

describe('the regime dialog’s rhythm (Design, 27/11)', () => {
  it('keeps a legend as far from its field as a label, and a field after a group of choices as far as any', () => {
    expect(css).toMatch(/\.bf-fieldset > legend \{[^}]*margin-bottom: 6px;/u);
    expect(css).toMatch(
      /\.bf-choices \+ \.nv-field__label \{\s*margin-top: calc\(var\(--nv-space-4\) - 6px\);/u,
    );
  });
});
