import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./face.css', import.meta.url), 'utf8');

describe('a creator in a chip (recette 07/11)', () => {
  it('cuts a long name with « … », never the row of chips (EXT-05)', () => {
    expect(css).toMatch(/\.cr-chip-name \{[^}]*max-width: 14rem;[^}]*text-overflow: ellipsis/u);
  });

  it('keeps her initial in its disc on the chosen chip, ink on void (EXT-03)', () => {
    expect(css).toMatch(
      /\.nv-chip\[aria-checked='true'\] \.cr-chip-face--initial \{[^}]*background: var\(--nv-void\);[^}]*color: var\(--nv-ink\)/u,
    );
  });
});
