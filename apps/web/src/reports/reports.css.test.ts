/// <reference types="node" />
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/* Read from disk: Vitest empties a stylesheet imported as a module, even with `?raw`. */
const css = readFileSync(new URL('./reports.css', import.meta.url), 'utf8');

describe('the reports’ colours (recette 05/11)', () => {
  it('marks a report to make in amber, not in the neon red of urgencies (CHAT-21)', () => {
    const at = css.indexOf('.rp-todo__mark {');
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('var(--nv-warning)');
    expect(rule).not.toContain('--nv-neon');
  });
});
