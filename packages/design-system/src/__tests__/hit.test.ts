import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../styles/components.css', import.meta.url), 'utf8');

describe('nv-hit (recette CHT-22)', () => {
  it('grows the target of a small text link to the minimum, without changing its words', () => {
    const at = css.indexOf('.nv-hit::after {');
    expect(at).toBeGreaterThan(-1);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('position: absolute');
    expect(rule).toContain('height: max(100%, var(--nv-target-min))');
  });
});
